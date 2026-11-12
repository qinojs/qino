// deno-lint-ignore-file no-explicit-any
import { test } from "node:test";
import { assert, assertEquals, testContext } from "./deps.ts";
import { LangManager, md5, migrateSmalltext } from "../lib/LangManager.ts";
import { Db } from "../lib/db/Db.ts";
import { requestStorage } from "../lib/ctx/Ctx.ts";

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

test("LangManager: setLangs normalizes languages and exposes default", () => {
  const lm = new LangManager({} as never);
  lm.setLangs([" DE ", "", "EN"]);
  assertEquals(lm.all, ["de", "en"]);
  assertEquals(lm.def, "de");
});

test("LangManager: initCtx prefers URL language then browser language", async () => {
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

test("LangManager: lang query overrides stored session language", async () => {
  const lm = new LangManager({} as never);
  lm.setLangs(["en", "de"]);

  const lang = sessionLang("en");
  const ctx = await testContext({ url: "http://qino.test/page?lang=de", sess: langSess(lang) });
  await lm.initCtx(ctx);

  assertEquals(ctx.langUsr, "de");
  assertEquals(lang(), "de");
});

test("LangManager: export groups translations by namespace and language, every language", async () => {
  await using db = await textDb([
    ["", "Log in", { de: "Anmelden", fr: "Connexion" }],
    ["cms", "Structure", { de: "Struktur", rm: "Structura" }],
    ["cms", "Empty", {}],
  ]);
  const lm = new LangManager({ db } as never);
  lm.setLangs("de, en");

  assertEquals(await lm.export(), {
    "": { de: { "Log in": "Anmelden" }, fr: { "Log in": "Connexion" } },
    cms: { de: { Structure: "Struktur" }, rm: { Structure: "Structura" } },
  });
});

test("LangManager: import seeds locale, skips empty, never overwrites, round-trips with export", async () => {
  await using db = await textDb([]);
  const lm = new LangManager({ db } as never);
  lm.setLangs(["de", "fr", "en"]);

  await lm.import("de", "cms", { Structure: "Struktur", Skip: "" }); // empty value ignored
  await lm.import("fr", "cms", { Structure: "Structure" });
  await lm.import("de", "cms", { Structure: "ÜBERSCHRIEBEN" }); // existing must stay
  await lm.import("en", "cms", { Structure: "0" });
  await lm.import("en", "cms", { Structure: "Overwritten" });
  await lm.import("rm", "cms", { Structure: "Structura" }); // not a site language: kept all the same
  await lm.import("de", "other", { Structure: "Other" });

  assertEquals(await lm.export(), {
    cms: { de: { Structure: "Struktur" }, fr: { Structure: "Structure" }, en: { Structure: "0" }, rm: { Structure: "Structura" } },
    other: { de: { Structure: "Other" } },
  });
});

test("LangManager: repeated locale import uses one read and no writes", async () => {
  await using db = await textDb([]);
  const lm = new LangManager({ db } as never);
  const txts = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`Original ${i}`, `Translation ${i}`]));
  await lm.import("de", "cms", txts);
  const query = db.query.bind(db), exec = db.exec.bind(db);
  let reads = 0, writes = 0;
  db.query = <T>(strings: TemplateStringsArray, ...values: unknown[]) => {
    reads++;
    return query<T>(strings, ...values);
  };
  db.exec = (...args) => {
    writes++;
    return Reflect.apply(exec, db, args);
  };
  await lm.import("de", "cms", JSON.stringify(txts));
  assertEquals([reads, writes], [1, 0]);
  await lm.import("missing_language", "cms", { Empty: "" });
  assertEquals([reads, writes], [1, 0]);
});

test("t.with: its namespace holds for parallel fragments, and nowhere else", async () => {
  await using x = await texts([], "de", "de");
  await x.run(() =>
    Promise.all([
      x.lm.t.with("fin", async () => {
        await new Promise((resolve) => setTimeout(resolve, 5)); // the other one runs meanwhile
        return x.lm.t`Invoice`;
      }),
      x.lm.t`Outside`,
    ]));
  await new Promise((r) => setTimeout(r, 20));
  assertEquals(await x.db.query`SELECT namespace, original FROM smalltext ORDER BY original`,
    [{ namespace: "fin", original: "Invoice" }, { namespace: "", original: "Outside" }]);
});

// ─── t, t.in, t.with over a real database ──────────────────────────────────────

type Texts = [ns: string, original: string, texts: Record<string, string>][];

/** smalltext + smalltext_lang in memory, with `rows`. */
async function textDb(rows: Texts) {
  const db = new Db("sqlite::memory:");
  await db.exec`CREATE TABLE smalltext (hash TEXT, namespace TEXT, original TEXT, count INTEGER DEFAULT 0, PRIMARY KEY (hash, namespace))`;
  await db.exec`CREATE TABLE smalltext_lang (hash TEXT, namespace TEXT, lang TEXT, text TEXT, PRIMARY KEY (hash, namespace, lang))`;
  await db.loadTables();
  for (const [ns, original, texts] of rows) {
    await db.exec`INSERT INTO smalltext (hash, namespace, original) VALUES (${md5(original)}, ${ns}, ${original})`;
    for (const [lang, text] of Object.entries(texts)) {
      await db.exec`INSERT INTO smalltext_lang (hash, namespace, lang, text) VALUES (${md5(original)}, ${ns}, ${lang}, ${text})`;
    }
  }
  return db;
}

/** A LangManager over `rows`, the site in `langs`, and `run` translating within a request in `lang`. */
async function texts(rows: Texts, langs: string, lang: string, set: Record<string, unknown> = {}) {
  const db = await textDb(rows);
  const app = { db, modules: { get: (name: string) => name === "cms" ? {} : undefined } };
  const lm = new LangManager(app as never);
  lm.setLangs(langs);
  const ctx = await testContext({ app, set: { dev: false, ...set } });
  ctx.lang = lang;
  const run = <R>(fn: () => R) => requestStorage.run(ctx, fn);
  return { db, lm, ctx, run, [Symbol.asyncDispose]: () => db.close() };
}

test("t: the namespace, then the global texts, then the next language by priority", async () => {
  await using x = await texts([
    ["cms", "A", { de: "A cms de", en: "A cms en" }],
    ["", "A", { de: "A global de" }],
    ["", "B", { de: "B global de" }],
    ["cms", "C", { en: "C cms en" }],
    ["", "C", { fr: "C global fr" }],
  ], "de, fr, en", "de");
  const t = x.lm.t.in("cms");
  assertEquals(await x.run(() => t`A`), "A cms de"); // namespace first
  assertEquals(await x.run(() => t`B`), "B global de"); // then global
  x.ctx.lang = "fr"; // fr has nothing for A: the site's languages by priority, de before en
  assertEquals(await x.run(() => t`A`), "A cms de");
  assertEquals(await x.run(() => t`C`), "C global fr"); // global fr before any other language
  assertEquals(await x.run(() => x.lm.t`A`), "A global de"); // without a namespace: the global ones only
});

test("t: English ends the search, the originals being English", async () => {
  await using x = await texts([["", "Save", { fr: "Enregistrer" }]], "de, en, fr", "de");
  assertEquals(await x.run(() => x.lm.t`Save`), "Save"); // de → en: the original, not the French
  x.ctx.lang = "en";
  assertEquals(await x.run(() => x.lm.t`Save`), "Save");
});

test("t: placeholders, values awaited", async () => {
  await using x = await texts([["", "Hello {0}, {1}", { de: "Hallo {1}, {0}" }]], "de", "de");
  assertEquals(await x.run(() => x.lm.t`Hello ${"Qino"}, ${Promise.resolve(2)}`), "Hallo 2, Qino");
});

test("t: a new text is added once, in the background, where no namespace in reach knows it", async () => {
  await using x = await texts([["", "Known", {}]], "de", "de");
  const t = x.lm.t.in("cms");
  assertEquals(await x.run(() => Promise.all([t`New`, t`New`, t`Known`])), ["New", "New", "Known"]);
  await new Promise((r) => setTimeout(r, 20)); // the insert runs after t answered
  assertEquals(await x.db.query`SELECT namespace, original FROM smalltext ORDER BY original`, [
    { namespace: "", original: "Known" }, // known globally: not added to cms
    { namespace: "cms", original: "New" },
  ]);
});

test("t: a new text seen in two languages is added once, not once per language", async () => {
  await using x = await texts([], "de, en", "de");
  const table = x.db.table.bind(x.db);
  let inserts = 0;
  x.db.table = ((name: string) => {
    const tb = table(name);
    return name === "smalltext" ? Object.assign(Object.create(tb), { insert: (v: Record<string, unknown>) => (inserts++, tb.insert(v)) }) : tb;
  }) as typeof x.db.table;
  await x.run(() => x.lm.t`Known`); // both indexes in memory, as in a running process
  x.ctx.lang = "en";
  await x.run(() => x.lm.t`Known`);
  inserts = 0;
  await x.run(() => x.lm.t`New`);
  x.ctx.lang = "de";
  await x.run(() => x.lm.t`New`);
  assertEquals(inserts, 1);
});

test("t: one query per namespace and language, the next lookups from memory", async () => {
  await using x = await texts([["", "A", { de: "a" }]], "de", "de");
  const query = x.db.query.bind(x.db);
  let reads = 0;
  x.db.query = ((...args: Parameters<typeof query>) => (reads++, query(...args))) as typeof query;
  for (let i = 0; i < 100; i++) await x.run(() => x.lm.t`A`);
  assertEquals(reads, 1);
  x.lm.clear();
  await x.run(() => x.lm.t`A`);
  assertEquals(reads, 2);
});

test("t.with: the namespace and language of a scope, also across await; t.in wins", async () => {
  await using x = await texts([
    ["cms", "A", { de: "A cms de", en: "A cms en" }],
    ["fin", "A", { de: "A fin de" }],
  ], "de, en", "de");
  const t = x.lm.t;
  assertEquals(await x.run(() => t.with("cms", async () => { await null; return t`A`; })), "A cms de");
  assertEquals(await x.run(() => t.with({ ns: "cms", lang: "en" }, () => t`A`)), "A cms en");
  assertEquals(await x.run(() => t.with("cms", () => t.in("fin")`A`)), "A fin de");
  assertEquals(await x.run(() => t.with("cms", () => t.with({ lang: "en" }, () => t`A`))), "A cms en"); // nested: merged
});

test("t: the user's language for a namespace (core.lang_ns) holds there only; ctx.lang stays", async () => {
  await using x = await texts([["cms", "A", { de: "A de", en: "A en" }], ["", "A", { de: "A global de" }]], "de, en", "de",
    { settings: { core: { lang_ns: { cms: () => "en", fin: () => "it" } } } });
  assertEquals(await x.run(() => x.lm.t.in("cms")`A`), "A en");
  assertEquals(await x.run(() => x.lm.t.in("fin")`A`), "A global de"); // it is no site language: the request's
  assertEquals(await x.run(() => x.lm.t`A`), "A global de");
  assertEquals(x.ctx.lang, "de");
});

test("t: dev marks a text found in no language of the search", async () => {
  await using x = await texts([["", "A", { fr: "a" }]], "de, fr", "de", { dev: true });
  assertEquals(await x.run(() => x.lm.t`A`), "a"); // found in fr: no mark
  assertEquals(await x.run(() => x.lm.t`B`), "*B*");
  x.ctx.lang = "en";
  x.lm.setLangs("en");
  assertEquals(await x.run(() => x.lm.t`B`), "B"); // English: the original is the text
});

test("t: onUse sees each lookup", async () => {
  await using x = await texts([], "de", "de");
  const used: string[] = [];
  x.lm.onUse = (ns, original) => used.push(`${ns}|${original}`);
  await x.run(() => Promise.all([x.lm.t`A`, x.lm.t.in("cms")`B`]));
  assertEquals(used, ["|A", "cms|B"]);
});

test("lookup: as t, for the browser; an unknown namespace is the global one, new texts only in dev", async () => {
  await using x = await texts([["cms", "A", { de: "A cms" }], ["", "A", { de: "A global" }]], "de", "de");
  assertEquals({ ...await x.lm.lookup(["A", "New"], "cms", x.ctx) }, { A: "A cms", New: "New" });
  assertEquals({ ...await x.lm.lookup(["A"], "nonsense", x.ctx) }, { A: "A global" });
  await new Promise((r) => setTimeout(r, 20));
  assertEquals(Number(await x.db.one`SELECT count(*) FROM smalltext`), 2); // not in dev: nothing added
});

test("migrateSmalltext: language columns become rows, once", async () => {
  await using db = new Db("sqlite::memory:");
  await db.exec`CREATE TABLE smalltext (hash TEXT, namespace TEXT, original TEXT, count INTEGER DEFAULT 0, de TEXT DEFAULT '', fr TEXT, PRIMARY KEY (hash, namespace))`;
  await db.exec`CREATE TABLE smalltext_lang (hash TEXT, namespace TEXT, lang TEXT, text TEXT, PRIMARY KEY (hash, namespace, lang))`;
  await db.exec`INSERT INTO smalltext (hash, namespace, original, de, fr) VALUES ('h1', '', 'Save', 'Speichern', NULL), ('h2', 'cms', 'Open', '', 'Ouvrir')`;
  await db.loadTables();

  await migrateSmalltext(db);
  assertEquals(await db.query`SELECT hash, namespace, lang, text FROM smalltext_lang ORDER BY hash`, [
    { hash: "h1", namespace: "", lang: "de", text: "Speichern" },
    { hash: "h2", namespace: "cms", lang: "fr", text: "Ouvrir" },
  ]);
  assertEquals([...db.table("smalltext").fields!.keys()].sort(), ["count", "hash", "namespace", "original"]);
  await migrateSmalltext(db); // again: nothing to do
  assertEquals(Number(await db.one`SELECT count(*) FROM smalltext_lang`), 2);
});

test("setLangs: a comma list or an array, trimmed and lowercased; none: en", () => {
  const lm = new LangManager({} as never);
  lm.setLangs("DE, en ,fr,");
  assertEquals(lm.all, ["de", "en", "fr"]);
  lm.setLangs("");
  assertEquals(lm.all, ["en"]);
  assert(lm.def === "en");
});

