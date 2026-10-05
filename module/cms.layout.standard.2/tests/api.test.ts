// deno-lint-ignore-file no-explicit-any
import { AccessError, ConflictError, NotFoundError, fs, invoke, requestStorage, toTools } from "@qino/qino";
import { assertEquals, assertRejects, assertStringIncludes, fakeCms } from "@qino/qino/tests";

import { api } from "../plugin.ts";
import { codeFiles } from "../codeFiles.ts";
import manifest from "../manifest.json" with { type: "json" };

const { name } = manifest;

function context(dir: string, access = 2, module = name, exists = true) {
  const node = {
    id: 7, vs: { module }, exists: () => exists,
    access: () => Promise.resolve(3), // Page access does not grant global file access.
    cms: { layoutPage: () => Promise.resolve({ access: () => Promise.resolve(access) }) },
    html: () => Promise.resolve("<div>rendered</div>"),
    module: {
      data: `${dir}data/${name}/`, dataUrl: `/prefix/d/${name}/`, modUrl: `/prefix/m/${name}/`,
      source: new URL("../plugin.ts", import.meta.url).href,
    },
  };
  const app = { assetRev: 0 };
  fakeCms(app, { node: () => node });
  const ctx = { app, user: {}, res: { html: { styles: new Set<string>(), scripts: new Set<string>() } } };
  return { node, ctx, call: (method: string, key: string, input = {}) => requestStorage.run(ctx as any, () => invoke(api, method, `/node/7/codefiles/${key}`, input)) };
}

Deno.test("standard.2 API: HTML/CSS tools; reading a missing file returns its starting point", async () => {
  const dir = await Deno.makeTempDir() + "/";
  const f = context(dir);
  try {
    assertEquals(toTools({ [name]: api }).map((tool) => tool.name), [
      "cmsLayoutStandard2_node_codefiles_html_get", "cmsLayoutStandard2_node_codefiles_html_put",
      "cmsLayoutStandard2_node_codefiles_css_get", "cmsLayoutStandard2_node_codefiles_css_put",
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

Deno.test("standard.2 API: global WRITE required, wrong module and missing node rejected", async () => {
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
