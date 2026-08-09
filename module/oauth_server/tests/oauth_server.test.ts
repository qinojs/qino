import { createHash } from "node:crypto";
import { assert, assertEquals, assertStringIncludes, testContext } from "../../core/tests/deps.ts";
import { b64url, Db, Output, unixTime, type Ctx } from "../../core/mod.ts";
import dbSchema from "../dbschema.json" with { type: "json" };
import { authorize, metadata, register, resourceMetadata, token } from "../mod.ts";
import { mint, verify } from "../lib/tokens.ts";

const REDIRECT = "https://client.test/callback";
const VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const CHALLENGE = b64url(new Uint8Array(createHash("sha256").update(VERIFIER).digest()));

async function makeDb(): Promise<Db> {
  const db = new Db("sqlite::memory:");
  await db.migrate(dbSchema);
  await db.query`CREATE TABLE usr (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL,
    active INTEGER NOT NULL, superuser INTEGER NOT NULL, pw TEXT NOT NULL)`;
  await db.loadTables();
  await db.table("usr").insert({ email: "user@qino.test", active: 1, superuser: 0, pw: "" });
  await db.table("oauth_client").insert({ id: "1", name: "Demo Client", redirect_uris: REDIRECT, created: unixTime() });
  return db;
}

/** Minimal `app.t`: substitutes the interpolated values, no lookup. */
const t = (strings: TemplateStringsArray, ...values: unknown[]) =>
  Promise.all(values).then((v) => strings.reduce((a, s, i) => a + s + (i < v.length ? String(v[i] ?? "") : ""), ""));

type CtxInit = {
  path: string;
  query?: Record<string, string>;
  form?: Record<string, string>;
  json?: unknown;
  userId?: number;
};

function makeCtx(db: Db, init: CtxInit): Promise<Ctx> {
  const url = new URL("http://qino.test/" + init.path);
  for (const [k, v] of Object.entries(init.query ?? {})) url.searchParams.set(k, v);
  let csrf = "csrf-test";
  return testContext({
    url: url.href,
    method: init.form || init.json !== undefined ? "POST" : "GET",
    body: init.json !== undefined ? JSON.stringify(init.json) : init.form ? new URLSearchParams(init.form) : undefined,
    headers: init.json !== undefined ? { "content-type": "application/json" } : undefined,
    sess: { data: { core: { userId: () => init.userId ?? 0, csrfToken: (v?: string) => (v !== undefined && (csrf = v), csrf) } } },
    app: { db, t, settings: { oauth_server: {} } },
  });
}

/** Every endpoint signals via a thrown `Output`; capture it. */
async function run(handler: (ctx: Ctx) => Promise<never>, ctx: Ctx | Promise<Ctx>) {
  try {
    await handler(await ctx);
  } catch (e) {
    if (e instanceof Output) return { status: e.status, text: String(e.body ?? ""), headers: e.buildHeaders() };
    throw e;
  }
  throw new Error("expected an Output signal");
}

const json = (res: { text: string }) => JSON.parse(res.text);
const location = (res: { headers: Headers }) => new URL(res.headers.get("Location")!);

const authQuery = (over: Record<string, string> = {}) => ({
  response_type: "code",
  client_id: "1",
  redirect_uri: REDIRECT,
  code_challenge: CHALLENGE,
  code_challenge_method: "S256",
  state: "xyz",
  ...over,
});

const codeForm = (code: string, over: Record<string, string> = {}) =>
  ({ grant_type: "authorization_code", code, client_id: "1", redirect_uri: REDIRECT, code_verifier: VERIFIER, ...over });

/** Consent → code: the happy path every client walks. */
async function grantCode(db: Db): Promise<string> {
  const res = await run(authorize, makeCtx(db, {
    path: "authorize",
    query: authQuery(),
    form: { oauth_consent: "1", csrfToken: "csrf-test" },
    userId: 1,
  }));
  assertEquals(res.status, 302);
  assertEquals(location(res).searchParams.get("state"), "xyz");
  return location(res).searchParams.get("code")!;
}

Deno.test("oauth_server: metadata describes the mounted app", async () => {
  const ctx = await makeCtx(await makeDb(), { path: ".well-known/oauth-authorization-server" });
  const m = await metadata(ctx);
  assertEquals(m.issuer, "http://qino.test");
  assertEquals(m.authorization_endpoint, "http://qino.test/authorize");
  assertEquals(m.token_endpoint, "http://qino.test/token");
  assertEquals(m.registration_endpoint, "http://qino.test/register");
  assertEquals(m.code_challenge_methods_supported, ["S256"]);
  assertEquals(m.token_endpoint_auth_methods_supported, ["none"]);
  assertEquals(resourceMetadata(ctx), { resource: "http://qino.test", authorization_servers: ["http://qino.test"] });
});

Deno.test("oauth_server: dynamic registration accepts https and loopback only", async () => {
  const db = await makeDb();
  const ok = await run(register, makeCtx(db, { path: "register", json: { client_name: "Demo Client", redirect_uris: [REDIRECT] } }));
  assertEquals(ok.status, 201);
  assertEquals(json(ok).redirect_uris, [REDIRECT]);
  assertEquals(json(ok).token_endpoint_auth_method, "none");
  assert(await db.row`SELECT id FROM oauth_client WHERE id = ${json(ok).client_id}`);

  const local = await run(register, makeCtx(db, { path: "register", json: { redirect_uris: ["http://127.0.0.1:8123/cb"] } }));
  assertEquals(local.status, 201);

  const bad = await run(register, makeCtx(db, { path: "register", json: { redirect_uris: ["http://evil.test/cb"] } }));
  assertEquals(bad.status, 400);
  assertEquals(json(bad).error, "invalid_redirect_uri");
});

Deno.test("oauth_server: authorize refuses unknown clients and unregistered redirect_uris", async () => {
  const db = await makeDb();
  const unknown = await run(authorize, makeCtx(db, { path: "authorize", query: authQuery({ client_id: "nope" }) }));
  assertEquals(unknown.status, 400);
  assertStringIncludes(unknown.text, "Unknown client_id");

  const wrong = await run(authorize, makeCtx(db, { path: "authorize", query: authQuery({ redirect_uri: "https://evil.test/cb" }) }));
  assertEquals(wrong.status, 400);
  assertStringIncludes(wrong.text, "not registered");
});

Deno.test("oauth_server: protocol errors go back to the authentic client", async () => {
  const db = await makeDb();
  const noPkce = await run(authorize, makeCtx(db, { path: "authorize", query: authQuery({ code_challenge: "", code_challenge_method: "" }) }));
  assertEquals(noPkce.status, 302);
  assertEquals(location(noPkce).origin + location(noPkce).pathname, REDIRECT);
  assertEquals(location(noPkce).searchParams.get("error"), "invalid_request");
  assertEquals(location(noPkce).searchParams.get("state"), "xyz");

  const denied = await run(authorize, makeCtx(db, { path: "authorize", query: authQuery(), form: { oauth_deny: "1" }, userId: 1 }));
  assertEquals(location(denied).searchParams.get("error"), "access_denied");
});

Deno.test("oauth_server: authorize asks for the core login, then for consent", async () => {
  const db = await makeDb();
  const anon = await run(authorize, makeCtx(db, { path: "authorize", query: authQuery() }));
  assertEquals(anon.status, 200);
  assertStringIncludes(anon.text, "name=core_login"); // the core logs the user in — this module never sees a password
  assertStringIncludes(anon.text, "Demo Client wants to access your account");

  const consent = await run(authorize, makeCtx(db, { path: "authorize", query: authQuery(), userId: 1 }));
  assertStringIncludes(consent.text, "name=oauth_consent");
  assertStringIncludes(consent.text, "user@qino.test");
});

Deno.test("oauth_server: consent needs a valid form token", async () => {
  const db = await makeDb();
  const res = await run(authorize, makeCtx(db, {
    path: "authorize",
    query: authQuery(),
    form: { oauth_consent: "1", csrfToken: "wrong" },
    userId: 1,
  }));
  assertEquals(res.status, 400);
  assertStringIncludes(res.text, "form token");
});

Deno.test("oauth_server: code exchange verifies PKCE and yields a usable access token", async () => {
  const db = await makeDb();
  const code = await grantCode(db);
  assert(code);

  const res = await run(token, makeCtx(db, { path: "token", form: codeForm(code) }));
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("Cache-Control"), "no-store");
  const body = json(res);
  assertEquals(body.token_type, "Bearer");
  assertEquals(body.expires_in, 3600);
  assert(body.access_token.startsWith("qo_"));

  const app = { db } as never;
  assertEquals(Number((await verify(app, "access", body.access_token))?.usr_id), 1);
  assertEquals(await verify(app, "access", body.refresh_token), undefined); // a refresh token is no bearer credential
});

Deno.test("oauth_server: a code is single-use and bound to verifier, client and redirect_uri", async () => {
  const db = await makeDb();
  const exchange = async (over: Record<string, string>) =>
    await run(token, makeCtx(db, { path: "token", form: codeForm(await grantCode(db), over) }));

  const wrongVerifier = await exchange({ code_verifier: "nope" });
  assertEquals(json(wrongVerifier).error, "invalid_grant");
  assertStringIncludes(json(wrongVerifier).error_description, "PKCE");
  assertEquals(json(await exchange({ redirect_uri: "https://evil.test/cb" })).error, "invalid_grant");
  assertEquals(json(await exchange({ client_id: "other" })).error, "invalid_grant");

  const code = await grantCode(db);
  const first = await run(token, makeCtx(db, { path: "token", form: codeForm(code) }));
  assertEquals(first.status, 200);
  const replay = await run(token, makeCtx(db, { path: "token", form: codeForm(code) }));
  assertEquals(replay.status, 400);
  assertEquals(json(replay).error, "invalid_grant");
});

Deno.test("oauth_server: refresh rotates the token", async () => {
  const db = await makeDb();
  const app = { db } as never;
  const refresh = await mint(app, { kind: "refresh", clientId: "1", usrId: 1, ttl: 600 });

  const res = await run(token, makeCtx(db, { path: "token", form: { grant_type: "refresh_token", refresh_token: refresh, client_id: "1" } }));
  const body = json(res);
  assert(body.access_token.startsWith("qo_"));
  assert(body.refresh_token !== refresh);
  assertEquals(await verify(app, "refresh", refresh), undefined); // the used one is gone

  const replay = await run(token, makeCtx(db, { path: "token", form: { grant_type: "refresh_token", refresh_token: refresh } }));
  assertEquals(json(replay).error, "invalid_grant");
});

Deno.test("oauth_server: unsupported grants and non-POST are rejected", async () => {
  const db = await makeDb();
  const bad = await run(token, makeCtx(db, { path: "token", form: { grant_type: "password" } }));
  assertEquals(json(bad).error, "unsupported_grant_type");
  const get = await run(token, makeCtx(db, { path: "token" }));
  assertEquals(get.status, 405);
});

Deno.test("oauth_server: tokens of an inactive user stop working", async () => {
  const db = await makeDb();
  const app = { db } as never;
  const access = await mint(app, { kind: "access", clientId: "1", usrId: 1, ttl: 600 });
  assert(await verify(app, "access", access));
  await db.exec`UPDATE usr SET active = ${false} WHERE id = ${1}`;
  assertEquals(await verify(app, "access", access), undefined);
});

Deno.test("oauth_server: expired tokens never verify", async () => {
  const db = await makeDb();
  const app = { db } as never;
  const access = await mint(app, { kind: "access", clientId: "1", usrId: 1, ttl: -1 });
  assertEquals(await verify(app, "access", access), undefined);
});
