// deno-lint-ignore-file no-explicit-any
import { invoke, requestStorage } from "@qino/qino";
import { assertEquals, testContext, fakeRender } from "@qino/qino/tests";
import { api } from "@qino/qino/cms.text";

import { cmsInstances } from "../lib/CMS.ts";

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
  pageTexts: Record<string, FakeText>;
  childNodes: FakeNode[] = [];

  constructor(id: number, titleText: FakeText, pageTexts: Record<string, FakeText> = {}) {
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

function setting<T>(initial: T) {
  let value = initial;
  const item = function(next?: T) {
    if (arguments.length) value = next as T;
    return value;
  } as any;
  item.then = (resolve: (value: T) => unknown, reject: (reason: unknown) => unknown) =>
    Promise.resolve(value).then(resolve, reject);
  return item;
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
  const node = new FakeNode(1, title, { main });
  const texts = new Map([[10, title], [11, main]]);
  const fetchOrg = globalThis.fetch;
  globalThis.fetch = ((url: string | URL) => {
    const params = new URL(String(url)).searchParams;
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        data: { translations: [{ translatedText: `${params.get("source")}-${params.get("target")}:${params.get("q")}` }] },
      }),
    } as Response);
  }) as typeof fetch;

  const ctx = await ctxWith({
    languages: { all: ["de", "en", "fr"] },
    cms: { node: () => node },
    dbTexts: { text: (id: number) => texts.get(id) },
    settings: {
      "cms.text": {
        "translation service": "google",
        google: { key: "" },
        "translate char count": setting(0),
      },
      "cms.backend.webmaster": { "google.api.key": "" },
    },
  });

  try {
    await requestStorage.run(ctx, async () => {
      assertEquals(await invoke(api, "POST", "/page/1/translate-all-langs", { ifNeeded: true }), { count: 4, fail: 0 });
    });
  } finally {
    globalThis.fetch = fetchOrg;
  }

  assertEquals(title.values, { de: "Titel", en: "de-en:Titel", fr: "en-fr:de-en:Titel" });
  assertEquals(main.values, { de: "Hallo", en: "de-en:Hallo", fr: "en-fr:de-en:Hallo" });
});
