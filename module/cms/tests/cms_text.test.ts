// deno-lint-ignore-file no-explicit-any
import { invoke, requestStorage } from "@qino/qino";
import { assertEquals, testContext, fakeRender } from "@qino/qino/tests";
import { api } from "@qino/qino/cms.text";

import { cmsInstances } from "../lib/CMS.ts";

import type { TranslateInput } from "@qino/qino/ai";

class FakeText {
  id: number;
  values: Record<string, string>;

  constructor(id: number, values: Record<string, string>) {
    this.id = id;
    this.values = values;
  }

  lang(lang: string) {
    return {
      get: () => this.values[lang] ?? "",
      set: (value: string) => { this.values[lang] = value; },
    };
  }
}

class FakeNode {
  id: number;
  titleText: FakeText;
  pageTexts: Map<string, FakeText>;
  childNodes: FakeNode[] = [];

  constructor(id: number, titleText: FakeText, pageTexts: Map<string, FakeText> = new Map()) {
    this.id = id;
    this.titleText = titleText;
    this.pageTexts = pageTexts;
  }

  access() { return 3; }
  title() { return this.titleText; }
  texts() { return this.pageTexts; }
  children() {
    return new Map(this.childNodes.map(node => [node.id, node]));
  }
}

async function ctxWith(app: any) {
  app.db ??= {};
  app.db.table ??= () => ({ row: () => ({ id: 1 }) });
  const { cms, ...rest } = app;
  const ctx = await testContext({ userId: 1, app: rest });
  if (cms) cmsInstances.set(ctx.app, cms);
  ctx.lang = "de";
  return ctx;
}

/** ai with a single translator, answering through `answer`. */
function translator(answer: (input: TranslateInput) => string) {
  const mods = [{ name: "ai", plugin: { aiAdapters: { fake: { translate: (_call: unknown, input: TranslateInput) => Promise.resolve(answer(input)) } } } }];
  const query = (strings: TemplateStringsArray) =>
    strings.join("").includes("ai_model_capability") ? [{ id: 1, model_id: 1, model: "fake", provider: "fake", type: "fake", endpoint: "" }] : [];
  return { modules: { linked: (name?: string) => name ? mods.find((m) => m.name === name) : mods }, db: { query }, settings: { core: { keys: {} } } };
}

Deno.test("cms.text: missing and empty texts are returned as untranslated", async () => {
  const ctx = await ctxWith({
    languages: { all: ["de", "en", "fr"] },
    api: { cms: { "node-id-from-txt-id": { get: () => Promise.resolve({ id: 1 }) } } },
    cms: { node: () => ({ access: () => 3 }) },
    db: {
      one: (...a: any[]) => {
        const [, params] = fakeRender(a[0], a.slice(1));
        const lang = params[1];
        if (lang === "de") return "Hallo";
        if (lang === "en") return "";
        return;
      },
    },
  });

  await requestStorage.run(ctx, async () => {
    assertEquals(await invoke(api, "GET", "/text/7"), [
      { lang: "de", text: "Hallo" },
      { lang: "en", text: false },
      { lang: "fr", text: false },
    ]);
  });
});

Deno.test("cms.text: translate-all-langs translates only missing or empty texts", async () => {
  const title = new FakeText(10, { de: "Titel", en: "", fr: "" });
  const main = new FakeText(11, { de: "Hallo", en: "" });
  const node = new FakeNode(1, title, new Map([["main", main]]));
  const texts = new Map([[10, title], [11, main]]);
  const ctx = await ctxWith({
    ...translator(({ text, from, to }) => `${from}-${to}:${text}`),
    languages: { all: ["de", "en", "fr"] },
    cms: { node: () => node },
    dbTexts: { text: (id: number) => texts.get(id) },
  });

  await requestStorage.run(ctx, async () => {
    assertEquals(await invoke(api, "POST", "/page/1/translate-all-langs", { ifNeeded: true }), { count: 4, fail: 0 });
    assertEquals(title.values, { de: "Titel", en: "de-en:Titel", fr: "en-fr:de-en:Titel" });
    assertEquals(main.values, { de: "Hallo", en: "de-en:Hallo", fr: "en-fr:de-en:Hallo" });
    assertEquals(await invoke(api, "POST", "/page/1/translate", { targetLang: "en", sourceLang: "clean" }), { count: 2, fail: 0 });
  });

  assertEquals(title.values, { de: "Titel", en: "", fr: "en-fr:de-en:Titel" });
  assertEquals(main.values, { de: "Hallo", en: "", fr: "en-fr:de-en:Hallo" });
});

Deno.test("cms.text: a text is translated through ai as html", async () => {
  const writes: unknown[] = [], asked: unknown[] = [];
  const ai = translator((input) => (asked.push(input), "hello"));
  const ctx = await ctxWith({
    modules: ai.modules,
    settings: ai.settings,
    languages: { all: ["de", "en"] },
    api: { cms: { "node-id-from-txt-id": { get: () => Promise.resolve({ id: 1 }) } } },
    cms: { node: () => ({ access: () => 3 }) },
    db: { ...ai.db, one: () => "Hallo", table: () => ({ row: () => ({ id: 1 }), ensure: (value: unknown) => writes.push(value) }) },
  });
  await requestStorage.run(ctx, async () => {
    assertEquals(await invoke(api, "POST", "/text/7/translate", { targetLang: "en", sourceLang: "de" }), true);
  });
  assertEquals(asked, [{ text: "Hallo", to: "en", from: "de", format: "html" }]);
  assertEquals(writes, [{ text_id: 7, lang: "en", text: "Hello" }]);
});
