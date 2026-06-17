// deno-lint-ignore-file no-explicit-any
import { assertEquals } from "./deps.ts";
import { LangManager } from "../lib/LangManager.ts";
import { RequestContext, requestStorage } from "../lib/RequestContext.ts";

function sessionLang(initial = "") {
  let value = initial;
  const fn = (next?: string) => {
    if (next !== undefined) value = next;
    return value;
  };
  return fn;
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

  const ctx = new RequestContext();
  ctx.appRequestPath = "fr/page";
  ctx.get = {};
  ctx.req = { header: () => "de;q=1" } as any;
  ctx.session = { liveUser: () => 0, qg: { lang: sessionLang() } } as any;
  await lm.initCtx(ctx);
  assertEquals(ctx.langUsr, "fr");
  assertEquals(ctx.lang, "fr");

  ctx.appRequestPath = "page";
  ctx.get = {};
  ctx.session = { liveUser: () => 0, qg: { lang: sessionLang() } } as any;
  ctx.req = { header: () => "fr-CH;q=0.9,de;q=0.8,en;q=0.7" } as any;
  await lm.initCtx(ctx);
  assertEquals(ctx.langUsr, "fr");
});

Deno.test("LangManager: changeLanguage query overrides stored session language", async () => {
  const lm = new LangManager({} as never);
  lm.setLangs(["en", "de"]);

  const lang = sessionLang("en");
  const ctx = new RequestContext();
  ctx.appRequestPath = "page";
  ctx.get = { changeLanguage: "de" };
  ctx.req = { header: () => "" } as any;
  ctx.session = { liveUser: () => 0, qg: { lang } } as any;
  await lm.initCtx(ctx);

  assertEquals(ctx.langUsr, "de");
  assertEquals(lang(), "de");
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
  const ctx = new RequestContext();
  ctx.lang = "de";
  ctx.langNs = "test";
  Object.defineProperty(ctx, "dev", { value: false }); // skip dev-mode marker

  const out = await requestStorage.run(ctx, () => lm.t`Hello ${"Qino"}`);
  assertEquals(out, "Hello Qino");
  assertEquals(queries.length, 0);
  assertEquals(inserts, [{
    namespace: "test",
    hash: "42155de5f888ca446f310e6f78affb94",
    original: "Hello ###1###",
  }]);
});
