// deno-lint-ignore-file no-explicit-any
import { Access, App, s } from "@qino/qino";
import { assertEquals } from "@qino/qino/tests";

import { history } from "../mod.ts";

const settle = () => new Promise((r) => setTimeout(r, 300)); // runs go in the background

Deno.test("sandbox.flow: active rows listen, changed rows anew, inactive or deleted ones not", async () => {
  const app = new App({ db: "sqlite::memory:", dir: await Deno.makeTempDir() + "/" });
  app.modules.add(new URL("../../sandbox/plugin.ts", import.meta.url));
  app.modules.add(new URL("../plugin.ts", import.meta.url));
  await app.init();
  const usr = app.db.table("usr");
  app.apiTree = {
    test: {
      greet: {
        post: {
          access: Access.USER,
          input: s.object({ name: s.string() }),
          execute: ({ name }: any) => usr.update(7, { given_name: name }),
        },
      },
    },
  };
  const given = () => app.db.one`SELECT given_name FROM usr WHERE id = 7`;
  const rename = async (family: string) => (await usr.update(7, { family_name: family }), await settle(), given());
  try {
    await app.settings.core.url("https://example.test/");
    await usr.insert({ id: 7, username: "ann@example.test", active: true });
    const code = `if (event.table !== "usr" || !("family_name" in event.data)) return;
      await tools.test_greet_post({ name: "Hi " + event.data.family_name });`;
    const flows = app.db.table("flow");
    const id = await flows.insert({
      description: "greet", host: "db", event: "table:update-after", usr_id: 7,
      tools: JSON.stringify(["test_greet_post"]), code, active: true, test: false,
    });
    assertEquals(await rename("Smith"), "Hi Smith"); // inserted active: listens

    await flows.update(id, { test: true });
    assertEquals(await rename("Jones"), "Hi Smith"); // changed: listens anew, now only testing

    await flows.update(id, { test: false, active: false });
    assertEquals(await rename("Brown"), "Hi Smith"); // inactive: silent

    await flows.update(id, { active: true });
    assertEquals(await rename("Green"), "Hi Green");

    await flows.delete(id);
    assertEquals(await rename("White"), "Hi Green"); // deleted: silent
  } finally {
    await new Promise((r) => setTimeout(r, 60)); // the session writes 50 ms later
    await app.db.close();
  }
});

Deno.test("sandbox.flow: a run ends with the version it began with, though its flow is saved meanwhile", async () => {
  const app = new App({ db: "sqlite::memory:", dir: await Deno.makeTempDir() + "/" });
  app.modules.add(new URL("../../sandbox/plugin.ts", import.meta.url));
  app.modules.add(new URL("../plugin.ts", import.meta.url));
  await app.init();
  try {
    await app.settings.core.url("https://example.test/");
    await app.db.table("usr").insert({ id: 7, username: "ann@example.test", active: true });
    const code = `if (event.table === "usr") return new Promise((r) => setTimeout(() => r("done"), 300));`;
    const flows = app.db.table("flow");
    const id = Number(await flows.insert({
      description: "slow", host: "db", event: "table:update-after", usr_id: 7,
      code, active: true,
    }));
    await app.db.table("usr").update(7, { family_name: "Smith" }); // starts a run
    await new Promise((r) => setTimeout(r, 100));
    await flows.update(id, { description: "saved meanwhile" }); // listens anew
    await flows.update(id, { test: false }); // and once more, right after
    await new Promise((r) => setTimeout(r, 600));
    assertEquals(history(app, id).runs.map((run) => [run.end, run.result]), [["done", "done"]]);
  } finally {
    await new Promise((r) => setTimeout(r, 60)); // the session writes 50 ms later
    await app.db.close();
  }
});

