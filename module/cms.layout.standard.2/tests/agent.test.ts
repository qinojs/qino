import { App } from "@qino/qino";
import { cms } from "@qino/qino/cms";
import { assertEquals, assertStringIncludes } from "@qino/qino/tests";

const NAME = "cms.layout.standard.2";

Deno.test("standard.2: its designer agent is told the u2 release the site loads", async () => {
  const dir = await Deno.makeTempDir() + "/";
  const app = new App({ db: "sqlite::memory:", dir });
  app.stores.add(import.meta.resolve("../../store.json")).add(NAME).add("ai.agent");
  try {
    await app.init();
    await (await cms(app).node(1)).createChild({ id: 5, module: NAME, visible: false }); // the system page
    await (await cms(app).layoutPage(NAME)).settings.u2Version("1.5.19");
    const id = Number(await app.db.one`SELECT id FROM ai_agent WHERE name = ${`${NAME}/designer`}`);
    const turn = await app.fire("ai.agent:turn", { agent: id, session: 0, usrId: 1, parts: [] as string[], tools: [] });
    assertStringIncludes(turn.parts.join(), "u2@1.5.19/SKILL.md");
    const other = await app.fire("ai.agent:turn", { agent: id + 1, session: 0, usrId: 1, parts: [] as string[], tools: [] });
    assertEquals(other.parts, []);
  } finally {
    await new Promise((resolve) => setTimeout(resolve, 100));
    await app.db.close();
    await Deno.remove(dir, { recursive: true });
  }
});
