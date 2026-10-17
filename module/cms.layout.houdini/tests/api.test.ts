// deno-lint-ignore-file no-explicit-any
import { AccessError, ConflictError, NotFoundError, fs, invoke, requestStorage, toTools } from "@qino/qino";
import { assertEquals, assertRejects, assertStringIncludes, fakeCms } from "@qino/qino/tests";

import { api, cms as layout } from "../plugin.ts";
import { codeFiles } from "../codeFiles.ts";
import manifest from "../manifest.json" with { type: "json" };

const { name } = manifest;

function context(dir: string, access = 2, module = name, exists = true) {
  const node = {
    id: 7, vs: { module }, exists: () => exists,
    access: () => Promise.resolve(3), // Page access does not grant global file access.
    cms: { layoutPage: () => Promise.resolve({
      id: 42, access: () => Promise.resolve(access),
      settings: { design: () => ({ color: "#80502e" }), u2Version: () => "" },
    }) },
    html: () => Promise.resolve("<div>rendered</div>"),
    module: {
      name: module,
      data: `${dir}data/${name}/`, dataUrl: `/prefix/d/${name}/`, modUrl: `/prefix/m/${name}/`,
      source: new URL("../plugin.ts", import.meta.url).href,
    },
  };
  const app = { assetRev: 0, modules: { linked: () => true }, assertAllowedPath: () => {} };
  fakeCms(app, { node: () => node });
  const ctx = {
    app, user: {}, req: { appUrl: "/prefix/" },
    sess: { data: { core: { grantKey: () => "test-key" } } },
    res: { html: { styles: new Set<string>(), scripts: new Set<string>() } },
  };
  return { node, ctx, call: (method: string, key: string, input = {}) => requestStorage.run(ctx as any, () => invoke(api, method, `/node/7/codefiles/${key}`, input)) };
}

Deno.test("houdini API: HTML/CSS tools; reading a missing file returns its starting point", async () => {
  const dir = await Deno.makeTempDir() + "/";
  const f = context(dir);
  try {
    assertEquals(toTools({ [name]: api }).map((tool) => tool.name), [
      "cmsLayoutHoudini_node_codefiles_html_get", "cmsLayoutHoudini_node_codefiles_html_put",
      "cmsLayoutHoudini_node_codefiles_css_get", "cmsLayoutHoudini_node_codefiles_css_put",
    ]);
    const files = codeFiles(f.node as any);
    assertStringIncludes((await f.call("GET", "html") as { content: string }).content, "popovertarget=head-nav");
    assertStringIncludes((await f.call("GET", "css") as { content: string }).content, "#container");
    assertEquals(await fs.isFile(files.html), false);
    assertEquals(await fs.isFile(files.css), false);
    await files.open("html");
    assertStringIncludes(await fs.text(files.html), "popovertarget=head-nav");
    await fs.write(files.html, "");
    await files.open("html");
    assertEquals(await fs.text(files.html), "");
    await fs.remove(files.html);

    const before = f.ctx.app.assetRev;
    await f.call("PUT", "css", { content: "/* First */" });
    const first = f.ctx.app.assetRev;
    await f.call("PUT", "css", { content: "/* Second */" });
    assertEquals(first > before && f.ctx.app.assetRev > first, true);

    for (const key of ["html", "css"]) {
      const content = key === "html" ? "<main>Custom</main>" : "";
      assertEquals(await f.call("PUT", key, { content }), "<div>rendered</div>");
      assertEquals(await f.call("GET", key), { content });
    }
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("houdini API: global WRITE required, wrong module and missing node rejected", async () => {
  const dir = await Deno.makeTempDir() + "/";
  try {
    const denied = context(dir, 1);
    for (const key of ["html", "css"]) {
      await assertRejects(() => denied.call("GET", key), AccessError);
      await assertRejects(() => denied.call("PUT", key, { content: "" }), AccessError);
    }
    assertEquals(await fs.isFile(codeFiles(denied.node as any).html), false);
    await assertRejects(() => context(dir, 2, "cms.cont.html").call("GET", "html"), ConflictError);
    await assertRejects(() => context(dir, 2, name, false).call("GET", "html"), NotFoundError);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("houdini panel: global WRITE protects design values and file editor capabilities", async () => {
  const dir = await Deno.makeTempDir() + "/";
  const denied = context(dir, 1);
  const allowed = context(dir);
  const panel = (f: ReturnType<typeof context>, vars: Record<string, unknown>) =>
    requestStorage.run(f.ctx as any, () => layout.node.api(f.node as any, vars));
  try {
    assertEquals(await panel(denied, { do: "getLayout" }), undefined);
    assertEquals(await panel(denied, { do: "openFile", key: "html" }), undefined);
    assertEquals(await fs.isFile(codeFiles(denied.node as any).html), false);
    const data = await panel(allowed, { do: "getLayout" }) as any;
    assertEquals(data.id, 42);
    assertEquals(data.module, name);
    assertEquals(data.design, { color: "#80502e" });
    assertEquals(data.u2Default, "1.8.0");
    assertEquals(data.files.map((file: any) => file.key), ["html", "css"]);
    assertEquals(data.files.every((file: any) => file.url.startsWith("/prefix/fileEditor?file=")), true);
    assertEquals(await panel(allowed, { do: "openFile", key: "../plugin.ts" }), false);
    await panel(allowed, { do: "openFile", key: "html" });
    assertStringIncludes(await fs.text(codeFiles(allowed.node as any).html), "u2-responsive");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
