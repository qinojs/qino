// deno-lint-ignore-file no-explicit-any
import { assertEquals, assertRejects, fakeCms } from "@qino/qino/tests";
import { AccessError, ConflictError, invoke, requestStorage, toTools } from "@qino/qino";
import { api } from "../plugin.ts";
import manifest from "../manifest.json" with { type: "json" };
const { name } = manifest;

const fakeNode = (dir: string, module = name, access = 2) => ({
  id: 7,
  vs: { module },
  exists: () => true,
  access: () => Promise.resolve(access),
  html: () => Promise.resolve("<div>rendered</div>"),
  module: {
    data: `${dir}data/${name}/`,
    dataUrl: `/d/${name}/`,
  },
});

const fakeCtx = (dir: string, module = name, access = 2) => {
  const node = fakeNode(dir, module, access);
  const app = {};
  fakeCms(app, { node: () => node });
  return { app, user: {} };
};

Deno.test("cms.cont.html api: tools describe each code file", () => {
  const tools = toTools({ [name]: api });
  assertEquals(tools.map((tool) => tool.name), [
    "get_cmsContHtml_node_codefiles_html",
    "put_cmsContHtml_node_codefiles_html",
    "get_cmsContHtml_node_codefiles_css",
    "put_cmsContHtml_node_codefiles_css",
    "get_cmsContHtml_node_codefiles_js",
    "put_cmsContHtml_node_codefiles_js",
  ]);
  assertEquals(tools[3].parameters, {
    type: "object",
    properties: {
      node: { type: "number", description: "ID of a node using the cms.cont.html module" },
      content: { type: "string", description: "Complete file content" },
    },
    required: ["node", "content"],
  });
});

Deno.test("cms.cont.html api: writes and reads code files", async () => {
  const dir = await Deno.makeTempDir() + "/";
  const ctx = fakeCtx(dir);
  try {
    assertEquals(
      await requestStorage.run(ctx as any, () => invoke(api, "PUT", "/node/7/codefiles/css", { content: "body {}\n" })),
      "<div>rendered</div>",
    );
    assertEquals(
      await requestStorage.run(ctx as any, () => invoke(api, "GET", "/node/7/codefiles/css")),
      { content: "body {}\n" },
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("cms.cont.html api: rejects nodes of another module", async () => {
  const dir = await Deno.makeTempDir() + "/";
  try {
    const ctx = fakeCtx(dir, "cms.cont.text");
    await assertRejects(
      () => requestStorage.run(ctx as any, () => invoke(api, "GET", "/node/7/codefiles/css")),
      ConflictError,
      "does not use cms.cont.html",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("cms.cont.html api: requires edit access to the node", async () => {
  const dir = await Deno.makeTempDir() + "/";
  try {
    const ctx = fakeCtx(dir, name, 1);
    await assertRejects(
      () => requestStorage.run(ctx as any, () => invoke(api, "GET", "/node/7/codefiles/css")),
      AccessError,
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
