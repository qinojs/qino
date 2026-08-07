// deno-lint-ignore-file require-await
import { assertEquals, assertRejects, testContext } from "../../core/tests/deps.ts";
import { AccessError, NotFoundError, ValidationError, invoke, html, requestStorage } from "../../core/mod.ts";
import { cmsInstances } from "../lib/CMS.ts";
import { api } from "../api.ts";

class TextObj {
  id: number;
  value: string;
  constructor(id: number, value: string) {
    this.id = id;
    this.value = value;
  }
  string() { return this.value; }
  toString() { return this.value; }
}

const fakeFile = (slot: string) => ({ name: `orig-${slot}`, mime: "image/jpeg", vs: { size: 4711 }, url: async () => `/dbFile/${slot}` });

class FakeNode {
  id: number;
  accessLevel: number;
  vs: Record<string, unknown>;
  writes: Record<string, unknown> = {};
  titleValue = "Title";
  textValues: Record<string, string> = {};
  userChanges: Array<[unknown, number]> = [];
  groupChanges: Array<[unknown, number]> = [];
  childNodes: FakeNode[] = [];
  fileNames = ["file.jpg"];
  allFileNames = ["file.jpg", "placeholder.jpg"];
  deletedFiles: string[] = [];

  constructor(id: number, accessLevel = 3, vs: Record<string, unknown> = {}) {
    this.id = id;
    this.accessLevel = accessLevel;
    this.vs = { id, module: "cms.cont.text", name: "", type: "p", ...vs };
  }

  exists() { return this; }
  async access() { return this.accessLevel; }
  set(key: string, value: unknown) { this.writes[key] = value; this.vs[key] = value; }
  async title(lang?: string, value?: string) {
    if (value !== undefined) {
      this.titleValue = `${lang}:${value}`;
      return true;
    }
    return new TextObj(this.id * 10, this.titleValue);
  }
  async showTitle() { return new TextObj(this.id * 10, this.titleValue); }
  async page() { return this; }
  async url() { return `/n${this.id}`; }
  async isOnline() { return true; }
  async isPublic() { return true; }
  async text(name: string, lang?: string, value?: string) {
    if (value !== undefined) {
      this.textValues[name] = `${lang}:${value}`;
      return true;
    }
    return new TextObj(this.id * 100, this.textValues[name] ?? "");
  }
  async texts() {
    return Object.fromEntries(Object.entries(this.textValues).map(([name, value]) => [name, {
      id: this.id * 100,
      lang: () => ({ get: async () => value }),
    }]));
  }
  html(vars = {}) { return html.raw(`<div>${JSON.stringify(vars)}</div>`); }
  htmlPart(part: string, vars = {}) { return `<span>${part}:${JSON.stringify(vars)}</span>`; }
  children(opt: Record<string, unknown>) {
    return new Map(this.childNodes
      .filter((node) => !opt.type || node.vs.type === opt.type)
      .map((node) => [node.id, node]));
  }
  conts() { return []; }
  createChild() { return 3; }
  createCont({ module }: { module: string }) {
    return new FakeNode(4, 3, { type: "c", module });
  }
  files() { return Object.fromEntries(this.fileNames.map((slot) => [slot, fakeFile(slot)])); }
  filesAndPlaceholders() { return Object.fromEntries(this.allFileNames.map((slot) => [slot, fakeFile(slot)])); }
  deleteFile(name: string) { this.deletedFiles.push(name); return true; }
  changeUser(user: unknown, access: number) { this.userChanges.push([user, access]); }
  changeGroup(group: unknown, access: number) { this.groupChanges.push([group, access]); }
  bough() { return new Map([[this.id, this]]); }
}

async function setup(access = 3) {
  const nodes = new Map<number, FakeNode>();
  nodes.set(1, new FakeNode(1, access));
  nodes.set(2, new FakeNode(2, 0));
  const user = { id: 9, get: () => false, toString: () => "9" };
  const ctx = await testContext({ userId: 9, app: {
    fire: (_name: string, e: unknown) => e, // no module:access handler → event unchanged
    db: {
      one: () => null,
      table: (name: string) => ({
        entry: () => name === "usr" ? user : null,
      }),
    },
  } });
  cmsInstances.set(ctx.app, {
    node: (id: number) => nodes.get(Number(id)) ?? { exists: () => undefined },
    getModules: () => ({ "cms.cont.text": { dir: undefined, plugin: { description: "Rich text", cms: { node: { settingsSchema: { properties: { cols: {} } } } } } } }),
    getLayouts: () => ({ "cms.layout.login": { dir: undefined, plugin: {} } }),
  } as never);
  ctx.lang = "de";
  return { ctx, nodes };
}

Deno.test("cms api: node title/text/flags write through resolved node", async () => {
  const { ctx, nodes } = await setup();
  const node = nodes.get(1)!;

  await requestStorage.run(ctx, async () => {
    assertEquals(await invoke(api, "PUT", "/node/1/title", { value: "Hallo" }), { changed: true });
    assertEquals(await invoke(api, "PUT", "/node/1/text/main", { value: "Text", lang: "en" }), { changed: true });
    const patched: any = await invoke(api, "PATCH", "/node/1", { visible: true, searchable: false, name: "n1", onlineStart: "2024-01-01T00:00:00Z", onlineEnd: "" });
    assertEquals(patched.id, 1);
    assertEquals(patched.visible, 1);
  });

  assertEquals(node.titleValue, "de:Hallo");
  assertEquals(node.textValues.main, "en:Text");
  assertEquals(node.writes.visible, 1);
  assertEquals(node.writes.searchable, 0);
  assertEquals(node.writes.name, "n1");
  assertEquals(node.writes.online_start, 1704067200);
  assertEquals(node.writes.online_end, undefined);
});

Deno.test("cms api: text fields are listed and read back without being created", async () => {
  const { ctx, nodes } = await setup();
  const node = nodes.get(1)!;

  await requestStorage.run(ctx, async () => {
    await invoke(api, "PUT", "/node/1/text/main", { value: "Hallo", lang: "de" });
    assertEquals(await invoke(api, "GET", "/node/1/texts"), { main: 100 });
    assertEquals(await invoke(api, "GET", "/node/1/text/main", { lang: "de" }), "de:Hallo");
    assertEquals(await invoke(api, "GET", "/node/1/text/unknown"), null);
  });

  assertEquals(Object.keys(node.textValues), ["main"]); // the read did not create "unknown"
});

Deno.test("cms api: html and html parts render through node helpers", async () => {
  const { ctx } = await setup();
  await requestStorage.run(ctx, async () => {
    assertEquals(await invoke(api, "GET", "/node/1/html", { vars: { a: 1 } }), '<div>{"a":1}</div>');
    assertEquals(await invoke(api, "POST", "/node/1/html", { vars: { b: 2 } }), '<div>{"b":2}</div>');
    assertEquals(await invoke(api, "GET", "/node/1/html/part/teaser", { vars: { c: 3 } }), '<span>teaser:{"c":3}</span>');
  });
});

Deno.test("cms api: contents returns readable content tree", async () => {
  const { ctx, nodes } = await setup();
  const node = nodes.get(1)!;
  const child = new FakeNode(10, 1, { type: "c", module: "cms.cont.text", name: "main" });
  child.titleValue = "Main";
  const hidden = new FakeNode(11, 0, { type: "c", module: "cms.cont.text", name: "hidden" });
  node.childNodes = [child, hidden];

  await requestStorage.run(ctx, async () => {
    assertEquals(await invoke(api, "GET", "/node/1/contents"), [{
      id: 10,
      module: "cms.cont.text",
      name: "main",
      title: "Main",
    }]);
  });
});

Deno.test("cms api: contents post returns rendered html and the block's shape", async () => {
  const { ctx } = await setup();
  await requestStorage.run(ctx, async () => {
    assertEquals(await invoke(api, "POST", "/node/1/contents", { module: "cms.text" }), {
      id: 4,
      html: "<div>{}</div>",
      contents: [],
      texts: {},
      files: { "file.jpg": { name: "orig-file.jpg", mime: "image/jpeg", size: 4711, url: "/dbFile/file.jpg" }, "placeholder.jpg": { placeholder: true } },
    });
  });
});

Deno.test("cms api: files lists placeholders", async () => {
  const { ctx } = await setup();
  await requestStorage.run(ctx, async () => {
    const file = { name: "orig-file.jpg", mime: "image/jpeg", size: 4711, url: "/dbFile/file.jpg" };
    assertEquals(await invoke(api, "GET", "/node/1/files"), { "file.jpg": file, "placeholder.jpg": { placeholder: true } });
  });
});

Deno.test("cms api: delete all files includes placeholders", async () => {
  const { ctx, nodes } = await setup();
  const node = nodes.get(1)!;

  await requestStorage.run(ctx, async () => {
    assertEquals(await invoke(api, "DELETE", "/node/1/files/all"), { ok: true });
  });

  assertEquals(node.deletedFiles, ["file.jpg", "placeholder.jpg"]);
});

Deno.test("cms api: user access and group access write through node", async () => {
  const { ctx, nodes } = await setup();
  const node = nodes.get(1)!;

  await requestStorage.run(ctx, async () => {
    assertEquals(await invoke(api, "PUT", "/node/1/access/users/5", { access: 2 }), { ok: true });
    assertEquals(await invoke(api, "PUT", "/node/1/access/groups/6", { access: 1 }), { ok: true });
  });

  assertEquals(node.userChanges, [[5, 2]]);
  assertEquals(node.groupChanges, [[6, 1]]);
});

Deno.test("cms api: resolve rejects missing and unreadable nodes", async () => {
  const { ctx } = await setup();
  await requestStorage.run(ctx, async () => {
    await assertRejects(() => invoke(api, "GET", "/node/99"), NotFoundError);
    await assertRejects(() => invoke(api, "GET", "/node/2"), AccessError);
  });
});

Deno.test("cms api: node write access is required for mutations", async () => {
  const { ctx } = await setup(1);
  await requestStorage.run(ctx, async () => {
    await assertRejects(() => invoke(api, "PUT", "/node/1/title", { value: "Nope" }), AccessError);
  });
});

Deno.test("cms api: validation rejects wrong params and payloads before writing", async () => {
  const { ctx, nodes } = await setup();
  const node = nodes.get(1)!;

  await requestStorage.run(ctx, async () => {
    await assertRejects(() => invoke(api, "PUT", "/node/not-a-number/title", { value: "Nope" }), ValidationError);
    await assertRejects(() => invoke(api, "PUT", "/node/1/title", {}), ValidationError);
    await assertRejects(() => invoke(api, "PUT", "/node/1/files", { sort: "file.txt" }), ValidationError);
  });

  assertEquals(node.titleValue, "Title");
  assertEquals(node.writes, {});
});

Deno.test("cms api: modules lists content and layout modules, schema on demand", async () => {
  const { ctx } = await setup();
  await requestStorage.run(ctx, async () => {
    assertEquals(await invoke(api, "GET", "/modules"), [
      { name: "cms.cont.text", kind: "cont", description: "Rich text" },
      { name: "cms.layout.login", kind: "layout", description: undefined },
    ]);
    const withSchema = await invoke(api, "GET", "/modules", { schema: true }) as Array<Record<string, unknown>>;
    assertEquals(withSchema[0].settings, { properties: { cols: {} } });
    assertEquals(withSchema[1].settings, {});
  });
});

Deno.test("cms api: modules hides what the user may not insert", async () => {
  const { ctx } = await setup();
  // deno-lint-ignore no-explicit-any
  (ctx.app as any).fire = (_n: string, e: any) => ({ ...e, access: 2 }); // below ADMIN
  await requestStorage.run(ctx, async () => {
    assertEquals(await invoke(api, "GET", "/modules"), []);
  });
});

Deno.test("cms api: admin access is required for access mutations", async () => {
  const { ctx } = await setup(2);
  await requestStorage.run(ctx, async () => {
    await assertRejects(() => invoke(api, "PUT", "/node/1/access", { value: 1 }), AccessError);
    await assertRejects(() => invoke(api, "PUT", "/node/1/access/users/5", { access: 2 }), AccessError);
    await assertRejects(() => invoke(api, "PUT", "/node/1/access/groups/6", { access: 1 }), AccessError);
  });
});
