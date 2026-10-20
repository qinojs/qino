// deno-lint-ignore-file no-explicit-any
import { assertEquals } from "@qino/qino/tests";
import { b64url, Output } from "@qino/qino";

import { allowed, relay } from "../plugin.ts";

const CALLBACK = "https://kunde.example.ch/oauth/callback/google";
const state = (url: string) => "rnd." + b64url(new TextEncoder().encode(url));

const ctxWith = (query: Record<string, string>, body: Record<string, string> | null = null, hosts = "*.example.ch") =>
  ({ req: { query, body }, app: { settings: { "auth.oauth.relay": { hosts } } } }) as any;

/** Run the relay and return where it sends the browser (or the error status). */
async function run(ctx: any) {
  try { await relay(ctx); } catch (e) {
    if (!(e instanceof Output)) throw e;
    return { status: e.status, location: e.buildHeaders().get("Location") ?? "" };
  }
  throw new Error("expected an Output signal");
}

Deno.test("auth.oauth.relay: allowed() matches exact hosts and *. subdomains", () => {
  assertEquals(allowed("a.ch, *.b.ch", "a.ch"), true);
  assertEquals(allowed("a.ch, *.b.ch", "x.b.ch"), true);
  assertEquals(allowed("a.ch, *.b.ch", "b.ch"), false);
  assertEquals(allowed("a.ch, *.b.ch", "evilb.ch"), false);
  assertEquals(allowed("", "a.ch"), false);
});

Deno.test("auth.oauth.relay: forwards code and state to the app named in the state", async () => {
  const s = state(CALLBACK);
  const res = await run(ctxWith({ code: "c1", state: s }));
  assertEquals(res.status, 303);
  const to = new URL(res.location);
  assertEquals(to.origin + to.pathname, CALLBACK);
  assertEquals(to.searchParams.get("code"), "c1");
  assertEquals(to.searchParams.get("state"), s);
});

Deno.test("auth.oauth.relay: a form_post becomes a GET with the same fields", async () => {
  const res = await run(ctxWith({}, { code: "c2", state: state(CALLBACK), user: '{"name":{}}' }));
  const to = new URL(res.location);
  assertEquals(to.searchParams.get("code"), "c2");
  assertEquals(to.searchParams.get("user"), '{"name":{}}');
});

Deno.test("auth.oauth.relay: refuses unlisted hosts, plain http and broken states", async () => {
  assertEquals((await run(ctxWith({ code: "c", state: state("https://evil.test/cb") }))).status, 400);
  assertEquals((await run(ctxWith({ code: "c", state: state("http://kunde.example.ch/cb") }))).status, 400);
  assertEquals((await run(ctxWith({ code: "c", state: "rnd.%%%" }))).status, 400);
  assertEquals((await run(ctxWith({ code: "c", state: "rnd" }))).status, 400);
});
