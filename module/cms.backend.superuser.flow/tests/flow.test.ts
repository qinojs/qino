// deno-lint-ignore-file no-explicit-any
import { App, runAs } from "@qino/qino";
import { assertEquals } from "@qino/qino/tests";

import api from "../nodeApi.ts";
import { cms } from "../plugin.ts";
import manifest from "../manifest.json" with { type: "json" };
import { renderDetail, renderList } from "../render.ts";

const t = (strings: TemplateStringsArray) => Promise.resolve(strings.join(""));
const plain = { t } as unknown as App;

const row = {
  id: 3, description: 'greet <b>"you"</b>', host: "db", event: "table:update-after", owner: "ann@example.test",
  tools: JSON.stringify(["test_greet_post"]), active: 1, test: 0,
  steps: JSON.stringify([
    { description: "wait", debounce: { ms: 500, by: "id" } },
    { description: "greet", fn: "(e) => '<script>'" },
  ]),
};

Deno.test("cms.backend.superuser.flow: metadata is wired", () => {
  assertEquals(manifest.name, "cms.backend.superuser.flow");
  assertEquals(manifest.dependencies, ["cms.backend", "sandbox.flow"]);
  assertEquals(Object.keys(cms.node.parts), ["list", "detail"]);
  assertEquals(typeof cms.node.api, "function");
});

Deno.test("cms.backend.superuser.flow: list and steps show the flow, escaped", async () => {
  const list = String(await renderList(plain, [row]));
  assertEquals(list.includes('<tr data-flow="3">'), true);
  assertEquals(list.includes("greet &lt;b&gt;&quot;you&quot;&lt;/b&gt;"), true);
  assertEquals(list.includes("<input type=checkbox data-set=active checked>"), true);
  assertEquals(list.includes("<input type=checkbox data-set=test>"), true);
  assertEquals(String(await renderList(plain, [])).includes("No flows yet"), true);

  const detail = String(await renderDetail(plain, row, { events: ["db table:update-after", "app route"] }));
  assertEquals(detail.includes('<input type=number name=ms min=0 value="500">'), true);
  assertEquals(detail.includes("<textarea name=fn rows=3>(e) =&gt; &#039;&lt;script&gt;&#039;</textarea>"), true);
  const tools = '<textarea name=tools rows=3 placeholder="one tool per line">test_greet_post</textarea>';
  assertEquals(detail.includes(tools), true);
  assertEquals(detail.includes("<option selected>db table:update-after</option><option>app route</option>"), true);
  assertEquals(String(await renderDetail(plain, undefined)).includes("Pick a flow."), true);
});

Deno.test("cms.backend.superuser.flow: the test run starts from the event's schema and tells its fields", async () => {
  const schema = {
    type: "object",
    properties: {
      table: { description: "The table." },
      id: { description: "The row's primary key." },
      data: { type: "object", description: "The row's values, by column." },
      lang: { type: "string" },
    },
  };
  const detail = String(await renderDetail(plain, row, { schema }));
  const example = JSON.parse(detail.match(/<textarea name=event rows=6>([^<]*)</)![1].replaceAll("&quot;", '"'));
  assertEquals(example, { table: null, id: null, data: {}, lang: "" });
  const field = "<dt><code>data</code> <small>object</small><dd>The row&#039;s values, by column.";
  assertEquals(detail.includes(field), true);
});

Deno.test("cms.backend.superuser.flow: the runs kept, and how many were not for it", async () => {
  const run = { time: new Date(), end: "done", steps: [{ description: "x", calls: [], value: "<b>" }] };
  const detail = String(await renderDetail(plain, row, { history: { runs: [run], filtered: 7 } }));
  assertEquals(detail.includes("7× not for it"), true);
  assertEquals(detail.includes(" · done</summary>"), true);
  assertEquals(detail.includes("&quot;value&quot;: &quot;&lt;b&gt;&quot;"), true);
  assertEquals(String(await renderDetail(plain, row)).includes("No runs yet."), true);
});

Deno.test("cms.backend.superuser.flow: switches, tries, saves and deletes a flow", async () => {
  const app = new App({ db: "sqlite::memory:", dir: await Deno.makeTempDir() + "/" });
  app.modules.add(new URL("../../sandbox/plugin.ts", import.meta.url));
  app.modules.add(new URL("../../sandbox.flow/plugin.ts", import.meta.url));
  await app.init();
  try {
    await app.settings.core.url("https://example.test/");
    await app.db.table("usr").insert({ id: 7, username: "ann@example.test", active: true, superuser: true });
    const id = Number(await app.db.table("flow").insert({
      host: "db", event: "table:update-after", usr_id: 7,
      steps: JSON.stringify([{ description: "double", fn: "(n) => n * 2" }]),
    }));
    // as the backend calls it: in a superuser's request
    const call = (vars: Record<string, unknown>): Promise<any> =>
      runAs(app, 7, "test", () => api({ app } as any, vars));
    assertEquals((await call({ flow: id, set: "active", value: true })).ok, true);
    assertEquals(Boolean(await app.db.one`SELECT active FROM flow WHERE id = ${id}`), true);

    const tried = await call({ flow: id, event: "21" });
    assertEquals([tried.ok, JSON.parse(tried.message).steps[0].value], [true, 42]);

    const steps = [{ description: "triple", fn: "(n) => n * 3" }, { description: "wait", debounce: { ms: 5 } }];
    const save = { description: "tripled", on: "app route", tools: " core_languages_get \n\n", steps };
    assertEquals((await call({ flow: id, save })).ok, true);
    const saved = await app.db.row`SELECT * FROM flow WHERE id = ${id}`;
    assertEquals([saved!.description, saved!.host, saved!.event], ["tripled", "app", "route"]);
    assertEquals([JSON.parse(String(saved!.tools)), JSON.parse(String(saved!.steps))], [["core_languages_get"], steps]);

    assertEquals((await call({ flow: id, delete: true })).ok, true);
    assertEquals((await call({ flow: id, delete: true })).ok, false); // gone
  } finally {
    await new Promise((r) => setTimeout(r, 60)); // the session writes 50 ms later
    await app.db.close();
  }
});
