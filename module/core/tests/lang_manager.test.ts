// deno-lint-ignore-file no-explicit-any
import { assertEquals, testContext } from "./deps.ts";
import { LangManager } from "../lib/LangManager.ts";
import { Db } from "../lib/db/Db.ts";
import { requestStorage } from "../lib/ctx/RequestContext.ts";

function sessionLang(initial = "") {
  let value = initial;
  const fn = (next?: string) => {
    if (next !== undefined) value = next;
    return value;
  };
  return fn;
}

function langSess(lang: ReturnType<typeof sessionLang>) {
  return { data: { core: { userId: () => 0, lang } } };
}

Deno.test("LangManager: setLangs normalizes languages and exposes default", () => {
  const lm = new LangManager({} as never);
  lm.setLangs([" DE ", "", "EN"]);
  assertEquals(lm.all, ["de", "en"]);
  assertEquals(lm.def, "de");
});

Deno.test("LangManager: initCtx prefers URL language then browser language", async () => {
  const lm = new LangManager({} as never);
  lm.setLangs(["en", "de", "fr"]);

  const ctx = await testContext({
    url: "http://qino.test/fr/page",
    headers: { "accept-language": "de;q=1" },
    sess: langSess(sessionLang()),
  });
  await lm.initCtx(ctx);
  assertEquals(ctx.langUsr, "fr");
  assertEquals(ctx.lang, "fr");

  const ctx2 = await testContext({
    url: "http://qino.test/page",
    headers: { "accept-language": "fr-CH;q=0.9,de;q=0.8,en;q=0.7" },
    sess: langSess(sessionLang()),
  });
  await lm.initCtx(ctx2);
  assertEquals(ctx2.langUsr, "fr");
});

Deno.test("LangManager: lang query overrides stored session language", async () => {
  const lm = new LangManager({} as never);
  lm.setLangs(["en", "de"]);

  const lang = sessionLang("en");
  const ctx = await testContext({ url: "http://qino.test/page?lang=de", sess: langSess(lang) });
  await lm.initCtx(ctx);

  assertEquals(ctx.langUsr, "de");
  assertEquals(lang(), "de");
});

Deno.test("LangManager: legacy changeLanguage alias still works", async () => {
  const lm = new LangManager({} as never);
  lm.setLangs(["en", "de"]);

  const ctx = await testContext({ url: "http://qino.test/page?changeLanguage=de", sess: langSess(sessionLang("en")) });
  await lm.initCtx(ctx);

  assertEquals(ctx.langUsr, "de");
});

Deno.test("LangManager: namespace start/stop changes active language", async () => {
  const lm = new LangManager({} as never);
  lm.setLangs(["de", "en"]);
  const ctx: any = {
    langUsr: "de",
    lang: "de",
    langNs: "",
    langNsPath: [],
    settings: { core: { lang_ns: { admin: () => "en", ignored: () => "it" } } },
  };

  await lm.nsStart("admin", ctx);
  assertEquals(ctx.langNs, "admin");
  assertEquals(ctx.lang, "en");
  await lm.nsStart("ignored", ctx);
  assertEquals(ctx.langNs, "ignored");
  assertEquals(ctx.lang, "de"); // "it" not in langs, fallback to langUsr
  lm.nsStop(ctx);
  assertEquals(ctx.langNs, "admin");
  assertEquals(ctx.lang, "en"); // back to admin's lang, not langUsr
  lm.nsStop(ctx);
  assertEquals(ctx.langNs, "");
  assertEquals(ctx.lang, "de"); // back to langUsr
});

Deno.test("LangManager: nested namespaces restore lang correctly", async () => {
  const lm = new LangManager({} as never);
  lm.setLangs(["de", "en", "fr"]);
  const ctx: any = {
    langUsr: "de",
    lang: "de",
    langNs: "",
    langNsPath: [],
    settings: { core: { lang_ns: { outer: () => "en", inner: () => "fr" } } },
  };

  await lm.nsStart("outer", ctx);
  assertEquals(ctx.lang, "en");
  await lm.nsStart("inner", ctx);
  assertEquals(ctx.lang, "fr");
  lm.nsStop(ctx);
  assertEquals(ctx.lang, "en"); // must restore outer's lang, not langUsr
  lm.nsStop(ctx);
  assertEquals(ctx.lang, "de");
});

Deno.test("LangManager: t inserts new smalltext and replaces placeholders", async () => {
  const queries: Array<[string, unknown[] | undefined]> = [];
  const inserts: Record<string, unknown>[] = [];
  const app = {
    db: {
      table: () => ({
        field: () => true,
        insert: (values: Record<string, unknown>) => { inserts.push(values); },
      }),
      indexCol: () => ({}),
      query: (sql: string, params?: unknown[]) => {
        queries.push([sql, params]);
        return [];
      },
    },
    settings: { core: { smalltext: { counter: false } } },
  };
  const lm = new LangManager(app as never);
  lm.setLangs(["de"]);
  const ctx = await testContext({ app, set: { dev: false } }); // dev false: skip dev-mode marker
  ctx.lang = "de";
  ctx.langNs = "test";

  const out = await requestStorage.run(ctx, () => lm.t`Hello ${"Qino"}`);
  assertEquals(out, "Hello Qino");
  assertEquals(queries.length, 0);
  assertEquals(inserts, [{
    namespace: "test",
    hash: "2e9121277bba2771720c1a8aee4ea9d2",
    original: "Hello {0}",
  }]);
});

Deno.test("LangManager: export groups non-empty translations by namespace and language", async () => {
  const rows = [
    { namespace: "", original: "Log in", de: "Anmelden", en: "", fr: "Connexion" },
    { namespace: "cms", original: "Structure", de: "Struktur", en: "", fr: "" },
    { namespace: "cms", original: "Empty", de: "", en: "", fr: "" },
  ];
  const lm = new LangManager({ db: { query: () => rows } } as never);
  lm.setLangs(["de", "en", "fr"]);

  assertEquals(await lm.export(), {
    "": { de: { "Log in": "Anmelden" }, fr: { "Log in": "Connexion" } },
    cms: { de: { Structure: "Struktur" } },
  });
});

Deno.test("LangManager: import seeds locale, skips empty, never overwrites, round-trips with export", async () => {
  const db = new Db("sqlite::memory:");
  await db.query`CREATE TABLE smalltext (hash TEXT, namespace TEXT, original TEXT, de TEXT DEFAULT '', fr TEXT DEFAULT '', en TEXT DEFAULT '', PRIMARY KEY (hash, namespace))`;
  await db.loadTables();
  const lm = new LangManager({ db } as never);
  lm.setLangs(["de", "fr", "en"]);

  await lm.import("de", "cms", { Structure: "Struktur", Skip: "" }); // empty value ignored
  await lm.import("fr", "cms", { Structure: "Structure" });
  await lm.import("de", "cms", { Structure: "ÜBERSCHRIEBEN" }); // existing must stay

  assertEquals(await lm.export(), {
    cms: { de: { Structure: "Struktur" }, fr: { Structure: "Structure" } },
  });
  await db.close();
});
