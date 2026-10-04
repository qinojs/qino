import { App } from "@qino/qino";
import { assertEquals, assertStringIncludes, fakeT } from "@qino/qino/tests";

import api from "../nodeApi.ts";
import { render } from "../render.ts";
import { settings } from "../settings.ts";

import type { Node } from "@qino/qino/cms";

Deno.test("home backend edits provider-owned settings, retains secrets and reconnects through Qino", async () => {
  const dir = await Deno.makeTempDir(), app = new App({ dir, db: "sqlite::memory:" });
  const schema = new URL("../../home.homeassistant/plugin.ts", import.meta.url).href;
  await Deno.writeTextFile(`${dir}/plugin.ts`, `
export { settingsSchema } from ${JSON.stringify(schema)};
export const homeProvider = { name: "custom", entities: async () => [], actions: async () => [] };
export async function init(app, { signal }) {
  const url = await app.settings["custom.provider"].url;
  if (url === "https://fail.test/") throw new Error("Rejected settings");
  app.fire("test:linked", { url });
  signal.addEventListener("abort", () => app.fire("test:unlinked", {}), { once: true });
}
`);
  app.modules.add(new URL("../../home/plugin.ts", import.meta.url));
  app.modules.add(new URL(`file://${dir}/plugin.ts`), "custom.provider");
  const linked: unknown[] = [], unlinked: unknown[] = [];
  app.on("test:linked", (event) => { linked.push(event); });
  app.on("test:unlinked", (event) => { unlinked.push(event); });
  const node = { app, id: 5 } as Node;
  try {
    await app.init();
    app.t = fakeT;
    await app.settings["custom.provider"].url("https://house.test/proxy/");
    await app.settings["custom.provider"].accessToken("stored-secret");
    const output = String(await settings(node));
    assertStringIncludes(output, "Home Assistant");
    assertStringIncludes(output, 'type="url"');
    assertStringIncludes(output, 'value="https://house.test/proxy/"');
    assertStringIncludes(output, 'type="password"');
    assertEquals(output.includes("stored-secret"), false);
    const page = String(await render(node));
    assertStringIncludes(page, '<div class=u2-flex>');
    assertStringIncludes(page, 'cms-part=settings style="display:contents"');
    assertEquals((page.match(/class=u2-card/g) ?? []).length, 2);
    assertEquals(await api(node, { config: { module: "custom.provider", values: { url: "https://new.test/", accessToken: "" } } }), {
      ok: true, message: "Settings saved. Reconnecting.",
    });
    assertEquals(await app.settings["custom.provider"].url, "https://new.test/");
    assertEquals(await app.settings["custom.provider"].accessToken, "stored-secret");
    assertEquals(linked.at(-1), { url: "https://new.test/" });
    assertEquals(unlinked.length, 1);
    for (const values of [
      { accessToken: "replacement", url: "javascript:bad" },
      { accessToken: "replacement", other: true },
      { accessToken: 123 },
    ]) {
      assertEquals((await api(node, { config: { module: "custom.provider", values } }) as { ok: boolean }).ok, false);
      assertEquals(await app.settings["custom.provider"].accessToken, "stored-secret");
      assertEquals(unlinked.length, 1);
    }
    assertEquals((await api(node, { config: { module: "core", values: { url: "https://bad.test/" } } }) as { ok: boolean }).ok, false);
    assertEquals((await api(node, { config: { module: "custom.provider", values: [] } }) as { ok: boolean }).ok, false);
    assertEquals(await api(node, { config: { module: "custom.provider", values: { accessToken: "replacement" } } }), {
      ok: true, message: "Settings saved. Reconnecting.",
    });
    assertEquals(await app.settings["custom.provider"].accessToken, "replacement");
    assertEquals(String(await settings(node)).includes("replacement"), false);
    assertEquals(await api(node, { config: { module: "custom.provider", values: { url: "https://fail.test/", accessToken: "failed-secret" } } }), {
      ok: false, message: "Rejected settings",
    });
    assertEquals(await app.settings["custom.provider"].url, "https://new.test/");
    assertEquals(await app.settings["custom.provider"].accessToken, "replacement");
    assertEquals(app.modules.linked("custom.provider")?.name, "custom.provider");
    assertEquals(linked.at(-1), { url: "https://new.test/" });
  } finally {
    app.modules.unlink("custom.provider");
    await app.db.close();
    await Deno.remove(dir, { recursive: true });
  }
});
