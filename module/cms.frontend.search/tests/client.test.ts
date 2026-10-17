import { runInNewContext } from "node:vm";
import { html } from "@qino/qino";
import { assert, assertEquals } from "@qino/qino/tests";

Deno.test("cms.frontend.search: its sidebar item mounts itself and restores the panel selection", async () => {
  const source = await Deno.readTextFile(new URL("../pub/init.js", import.meta.url));
  const handlers = new Map<string, (e: { value: string }) => void>();
  const mounts: unknown[] = [], classes: string[] = [];
  const selected: string[] = [];
  let shortcut = (_key: string, _event: { preventDefault(): void }) => {};
  let inserted: unknown, focused = false;
  const item = {
    className: "", innerHTML: "", setAttribute() {},
    firstElementChild: { append: (child: unknown) => mounts.push(child) },
    classList: { add: (name: string) => classes.push(name) },
    querySelector: () => ({ focus: () => focused = true }),
  };
  const panel = {
    querySelector: () => ({ querySelector: () => ({ before: (el: unknown) => inserted = el }) }),
    classList: { add: (name: string) => classes.push(name) },
  };
  const code = source.replace(/^import .*;\n/gm, "").replace(/^await import.*;\n/gm, "")
    .replace(/^const \{ (?:widget|onShortcut) \} = await import.*;\n/gm, "")
    .replaceAll("import.meta.url", "'https://qino.test/m/cms.frontend.search/pub/init.js'");
  await runInNewContext(`(async () => { ${code} })()`, {
    html, URL, ctx: {}, qino: { cms: { nodeId: 42 } },
    t: (s: TemplateStringsArray) => Promise.resolve(s.join("")),
    document: { createElement: () => item },
    onShortcut: (fn: typeof shortcut) => shortcut = fn,
    widget: (src: string, context: unknown) => ({ src, context }),
    cms: { panelRoot: { getElementById: () => panel }, panel: { sidebar: {
      value: "cms.frontend.search", addEventListener: (name: string, fn: (e: { value: string }) => void) => handlers.set(name, fn),
      set: (value: string) => selected.push(value),
    } } },
  });
  assertEquals(inserted, item);
  assertEquals(classes, ["-open", "-open"]);
  assertEquals(JSON.parse(JSON.stringify(mounts)), [{
    src: "https://qino.test/m/cms.frontend.search/pub/widget.js", context: { node: { id: 42 } },
  }]);
  handlers.get("set")!({ value: "tree" });
  assertEquals(focused, false);
  handlers.get("set")!({ value: "cms.frontend.search" });
  assertEquals(focused, true);
  let prevented = 0;
  for (const key of ["x", "k"]) shortcut(key, { preventDefault: () => prevented++ });
  assertEquals(prevented, 1);
  assertEquals(selected, ["cms.frontend.search"]);
  assertEquals(classes.at(-1), "-sidebar-open");
});

Deno.test("cms.frontend.search: the widget escapes results, cancels stale queries and cleans up on unmount", async () => {
  const source = await Deno.readTextFile(new URL("../pub/widget.js", import.meta.url));
  const handlers = new Map<string, (...args: unknown[]) => void>();
  const timers = new Map<number, () => void>();
  const calls: { query: Record<string, unknown>; signal: AbortSignal; resolve: (found: unknown) => void }[] = [];
  let focus = () => {}, selections = 0;
  const input = {
    value: "", select: () => selections++,
    addEventListener: (_name: string, handler: () => void) => focus = handler,
  };
  const focused: number[] = [], closed: string[] = [];
  let clicks = 0, form = "";
  const stored = new Map<string, string>();
  const links = [0, 1].map((id) => {
    const classes = new Set<string>();
    const row = { classList: { add: (name: string) => classes.add(name), remove: (name: string) => classes.delete(name) } };
    const link = {
      focus: () => { focused.push(id); handlers.get("focusin")!(link); },
      scrollIntoView() {}, click: () => clicks++,
      closest: (selector: string): unknown => selector === "tr" ? row : link,
    };
    return link;
  });
  const output = {
    innerHTML: "", textContent: "", replaceChildren() { this.innerHTML = ""; this.textContent = ""; },
    querySelector: () => String(output.innerHTML).includes('data-result') ? links[0] : null,
    querySelectorAll: (selector: string) => selector === '[data-result]' ? links : [],
  };
  let timer = 0;
  const widget = {
    head: "", html: async (strings: TemplateStringsArray, ...values: unknown[]) => { form = String(await html.async(strings, ...values)); },
    addEventListener() {},
    querySelector: (selector: string) => selector === "input" ? input : output,
    on: (name: string, selector: string | ((...args: unknown[]) => void), fn?: (...args: unknown[]) => void) => handlers.set(name, typeof selector === "function" ? selector : fn!),
  };
  const mount = runInNewContext(source.replace(/^import .*;\n/gm, "")
    .replace("export const css", "const css")
    .replace("export default async function", "async function mount") + "\nmount", {
    html, AbortController, AbortSignal,
    ctx: { appUrl: '/site/' },
    sessionStorage: { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => stored.set(key, value), removeItem: (key: string) => stored.delete(key) },
    t: (s: TemplateStringsArray, ...values: unknown[]) => Promise.resolve(s.reduce((out, part, i) => out + part + (values[i] ?? ''), '')),
    cms: { panel: { sidebar: { set: (value: string) => closed.push(value) } } },
    setTimeout: (fn: () => void) => (timers.set(++timer, fn), timer),
    clearTimeout: (id: number) => timers.delete(id),
    api: { "cms.frontend.search": { search: { get: (query: Record<string, unknown>, { signal }: { signal: AbortSignal }) =>
      new Promise((resolve) => calls.push({ query, signal, resolve })) } } },
  });
  const cleanup = await mount(widget, { node: { id: 42 }, signal: new AbortController().signal });
  assert(!form.includes('<button'), form);
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  const type = async (value: string) => {
    input.value = value;
    handlers.get("input")!();
    for (const fn of timers.values()) fn();
    timers.clear();
    await settle();
  };
  await type("old");
  await type("cont.text");
  focus();
  assertEquals(selections, 1);
  assertEquals(input.value, "cont.text");
  assertEquals(stored.get('cms.frontend.search:/site/'), 'cont.text');
  assertEquals(calls[0].signal.aborted, true);
  assertEquals(JSON.parse(JSON.stringify(calls[1].query)), { pid: 42, search: "cont.text" });
  calls[1].resolve({
    contents: [{ title: "<script>", info: "cms.cont.text", snippet: "A cont.text & <example>", url: "/?cmspid=7&cms_editmode=1", breadcrumb: [{ title: "Parent <page>", url: "/parent" }] }],
    files: [{ title: "Image", info: "image/png", url: "/file", thumb: "/preview?sig=test", pages: [{ title: "Usage", url: "/usage", breadcrumb: [] }] }],
    limit: 1,
  });
  await settle();
  const result = String(output.innerHTML);
  assert(result.includes("&lt;script&gt;") && !result.includes("<script>"), result);
  assert(result.includes('href="/parent">Parent &lt;page&gt;</a>'), result);
  assert(result.includes('<img src="/preview?sig=test" alt="" loading=lazy>'), result);
  assert(result.includes('A <mark>cont.text</mark> &amp; &lt;example&gt;'), result);
  assert(result.includes('First 1 results') && result.includes('href="/usage">Usage</a>'), result);
  let keys = 0, blurred = false;
  const key = (name: string, target: unknown) => handlers.get('keydown')!(null, { key: name, target, preventDefault: () => keys++ });
  key('ArrowDown', { closest: () => null });
  key('ArrowDown', links[0]);
  key('ArrowUp', links[1]);
  assertEquals(focused, [0, 1, 0]);
  handlers.get('submit')!(null, { preventDefault() {} });
  assertEquals(clicks, 1);
  key('Escape', { blur: () => blurred = true });
  assertEquals(closed, ['']);
  assert(blurred && keys === 4);
  calls[0].resolve({ pages: [{ title: "Old result", url: "/old" }] });
  await settle();
  assertEquals(String(output.innerHTML), result);
  await type("");
  assertEquals(output.innerHTML, "");
  assertEquals(stored.has('cms.frontend.search:/site/'), false);
  let prevented = false;
  handlers.get("submit")!(null, { preventDefault: () => prevented = true });
  assertEquals(prevented, true);
  await type("pending");
  cleanup();
  assertEquals(calls[2].signal.aborted, true);
  calls[2].resolve({});
  await settle();
  assertEquals(output.innerHTML, "");
  input.value = '';
  const restored = await mount(widget, { node: { id: 42 }, signal: new AbortController().signal });
  assertEquals(input.value, 'pending');
  for (const fn of timers.values()) fn();
  timers.clear();
  await settle();
  assertEquals(calls[3].query.search, 'pending');
  calls[3].resolve({});
  await settle();
  restored();
});
