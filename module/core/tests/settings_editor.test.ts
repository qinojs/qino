import { runInNewContext } from "node:vm";
import { assertEquals } from "@qino/qino/tests";

Deno.test("SettingsEditor saves the input captured before shadow DOM event retargeting", async () => {
  const source = await Deno.readTextFile(new URL("../pub/js/SettingsEditor.mjs", import.meta.url));
  const listeners = new Map<string, (event: { target: unknown }) => void>();
  const writes: unknown[] = [];
  let timer: () => Promise<void>;
  let editor: { connectedCallback(): void };
  const item = { keys: [], setSchema() {}, sub: () => ({ set() {} }) };
  const settings = {
    get: () => Promise.resolve({}),
    "col-width": { put: (value: unknown) => { writes.push(value); return Promise.resolve(); } },
  };
  runInNewContext(source
    .replace(/^import .*;\n/gm, "")
    .replace(/^const itemJs(?:HtmlRenderer)? = .*;\n/gm, ""), {
    itemJs: Promise.resolve({ item: () => item }),
    itemJsHtmlRenderer: Promise.resolve(() => ""),
    api: { cms: { node: () => settings } },
    console,
    HTMLElement: class {
      addEventListener(type: string, listener: (event: { target: unknown }) => void) { listeners.set(type, listener); }
      getAttribute() { return "/api/cms/node/1912/settings"; }
      getRootNode() { return { getElementById: () => true }; }
    },
    customElements: { define: (_name: string, constructor: new () => typeof editor) => { editor = new constructor(); } },
    setTimeout: (callback: typeof timer) => { timer = callback; return 1; },
    clearTimeout() {},
  });
  editor!.connectedCallback();
  for (let i = 0; i < 10; i++) await Promise.resolve();

  const event = { target: { name: '["col-width"]', type: "number", valueAsNumber: 16 } as unknown };
  listeners.get("input")!(event);
  event.target = { tagName: "QINO-CMS" };
  await timer!();
  assertEquals(JSON.parse(JSON.stringify(writes)), [{ value: 16 }]);
});
