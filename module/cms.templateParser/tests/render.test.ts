// deno-lint-ignore-file no-explicit-any
import { assertEquals } from "@qino/qino/tests";
import { parseTemplate } from "../parse.ts";
import { renderNodes } from "../render.ts";

/** Minimal Node stand-in; cms/text/cont record their calls */
function fakeNode(over: Record<string, any> = {}): any {
  const node: any = {
    app: { dev: false },
    edit: false,
    module: { name: "cms.cont.test" },
    calls: [] as any[],
    ...over,
  };
  node.cms ??= {};
  node.exists ??= () => node;
  node.showTitle ??= () => "Target title";
  node.cms.linkAttributes ??= async (target: any) => ({ href: await target.url(), class: "cmsLink7" });
  node.cms.text ??= (target: any, name: string, options: any) => {
    node.calls.push({ target, name, options });
    return `[text:${name}]`;
  };
  node.cont ??= (name: string, module: string) => {
    node.calls.push({ name, module });
    return { html: () => `[cont:${name}:${module}]` };
  };
  return node;
}

const render = (tpl: string, node: any) => renderNodes(parseTemplate(tpl), node);

Deno.test("render: static html passes through, void and bare attrs kept", async () => {
  const out = await render(`<div class=a data-x><br><img src=logo.png></div>`, fakeNode());
  assertEquals(out, `<div class="a" data-x><br><img src="logo.png"></div>`);
});

Deno.test("render: attribute values are escaped", async () => {
  const out = await render(`<div title='say "hi"'>x</div>`, fakeNode());
  assertEquals(out, `<div title="say &quot;hi&quot;">x</div>`);
});

Deno.test("cms-text: tag, options passthrough, inner html as initial", async () => {
  const node = fakeNode();
  const out = await render(`<h2 cms-text=title class=big>Hello <b>world</b></h2>`, node);
  assertEquals(out, "[text:title]");
  const { target, name, options } = node.calls[0];
  assertEquals(target, node);
  assertEquals(name, "title");
  assertEquals(options.tag, "h2");
  assertEquals(options.class, "big");
  assertEquals(options.initial, "Hello <b>world</b>");
  assertEquals("cms-text" in options, false);
});

Deno.test("cms-text: bare attribute becomes true option, no initial when empty", async () => {
  const node = fakeNode();
  await render(`<p cms-text=note if></p>`, node);
  const { options } = node.calls[0];
  assertEquals(options.if, true);
  assertEquals("initial" in options, false);
});

Deno.test("cms-text: without value renders as plain element", async () => {
  const out = await render(`<p cms-text></p>`, fakeNode());
  assertEquals(out, `<p cms-text></p>`);
});

Deno.test("cms-cont: name, module and default module", async () => {
  const node = fakeNode();
  const out = await render(`<cms-cont name=body module=cms.cont.text /><cms-cont name=aside />`, node);
  assertEquals(out, "[cont:body:cms.cont.text][cont:aside:cms.cont.flexible]");
  const out2 = await render(`<cms-cont name=x default-module=cms.cont.nav3 />`, node);
  assertEquals(out2, "[cont:x:cms.cont.nav3]");
});

Deno.test("cms-cont / cms-image: without name render nothing", async () => {
  assertEquals(await render(`<cms-cont />`, fakeNode()), "");
  assertEquals(await render(`<cms-image width=100 />`, fakeNode()), "");
});

Deno.test("unknown cms-* element passes through", async () => {
  assertEquals(await render(`<cms-foo>x</cms-foo>`, fakeNode()), `<cms-foo>x</cms-foo>`);
});

Deno.test("node=page: construct targets the enclosing page", async () => {
  const page = fakeNode();
  const node = fakeNode({ page: () => page, cms: page.cms });
  await render(`<h1 cms-text=title node=page></h1>`, node);
  const { target, options } = page.calls[0];
  assertEquals(target, page);
  assertEquals("node" in options, false);
});

Deno.test("node=<id>: construct targets that node", async () => {
  const seven = fakeNode();
  const node = fakeNode({ cms: { ...seven.cms, node: (id: number) => (assertEquals(id, 7), seven) } });
  await render(`<div cms-text=main node=7></div>`, node);
  assertEquals(seven.calls[0].target, seven);
});

Deno.test("node=parent(2): level is passed to node.parent", async () => {
  const ancestor = fakeNode();
  let level: unknown = "unset";
  const node = fakeNode({ parent: (l?: number) => (level = l, ancestor) });
  await render(`<div cms-text=main node=parent(2)></div>`, node);
  assertEquals(level, 2);
  assertEquals(ancestor.calls[0].target, ancestor);

  await render(`<div cms-text=main node=parent></div>`, node);
  assertEquals(level, undefined);
});

Deno.test("node=layout: resolves layout page via the page's module", async () => {
  const layout = fakeNode();
  const page = fakeNode({ module: { name: "cms.layout.custom.9" } });
  const node = fakeNode({
    page: () => page,
    cms: { ...layout.cms, layoutPage: (m: string) => (assertEquals(m, "cms.layout.custom.9"), layout) },
  });
  const out = await render(`<cms-cont name=nav node=layout />`, node);
  assertEquals(out, "[cont:nav:cms.cont.flexible]");
  assertEquals(layout.calls[0], { name: "nav", module: "cms.cont.flexible" });
});

Deno.test("node=: unresolvable renders nothing", async () => {
  const node = fakeNode({ parent: () => undefined });
  assertEquals(await render(`<div cms-text=main node=xyz></div>`, node), "");
  assertEquals(await render(`<div cms-text=main node=parent></div>`, node), "");
});

Deno.test("cms-link: resolves a node href and keeps the wrapper", async () => {
  const target = fakeNode({ url: () => `/target?x=1&y=2` });
  const node = fakeNode({ cms: { node: (id: number) => (assertEquals(id, 7), target) } });
  assertEquals(
    await render(`<a class=card href=/old cms-link=7><b>Target</b></a>`, node),
    `<a href="/target?x=1&amp;y=2" class="card cmsLink7"><b>Target</b></a>`,
  );
});

Deno.test("cms-link: composes with cms-text", async () => {
  const page = fakeNode({ url: () => "/page" });
  page.cms.text = (target: any, name: string, options: any) => {
    page.calls.push({ target, name, options });
    return `<a href="${options.href}" class="${options.class}">[text:${name}]</a>`;
  };
  const node = fakeNode({ page: () => page, cms: page.cms });
  const out = await render(`<a cms-link=page cms-text=label class=more>More</a>`, node);
  assertEquals(out, `<a href="/page" class="more cmsLink7">[text:label]</a>`);
  assertEquals(page.calls[0].target, node);
  assertEquals(page.calls[0].options, { tag: "a", href: "/page", class: "more cmsLink7", initial: "More" });
});

Deno.test("cms-link: invalid targets keep the content without a broken href", async () => {
  assertEquals(await render(`<a cms-link=missing>Still here</a>`, fakeNode()), `<a>Still here</a>`);
});

Deno.test("cms-link: an empty wrapper uses the target title", async () => {
  const target = fakeNode({ url: () => "/target", showTitle: () => "Target <b>title</b>" });
  const node = fakeNode({ cms: { ...target.cms, node: () => target } });
  assertEquals(
    await render(`<a cms-link=7></a>`, node),
    `<a href="/target" class="cmsLink7">Target <b>title</b></a>`,
  );
});

Deno.test("cms-link: an explicit target overrides the page target", async () => {
  const target = fakeNode({ url: () => "/target" });
  target.cms.linkAttributes = async () => ({ href: "/target", class: "cmsLink7", target: "_blank" });
  const node = fakeNode({ cms: { ...target.cms, node: () => target } });
  assertEquals(
    await render(`<a cms-link=7 class=card target=mytarget>Target</a>`, node),
    `<a target="mytarget" href="/target" class="card cmsLink7">Target</a>`,
  );
});
