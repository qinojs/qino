import { App } from "@qino/qino";
import { cms } from "@qino/qino/cms";
import { assertEquals } from "@qino/qino/tests";

import { ageColor, install, link, takeOver } from "../lib/backend.ts";

Deno.test("cms.backend: ageColor fades from green over orange to none", () => {
  assertEquals(ageColor(1000, 1000), "color-mix(in oklch, var(--orange) 0%, var(--green))");
  assertEquals(ageColor(1000, 1060), "color-mix(in oklch, var(--orange) 50%, var(--green))");
  assertEquals(ageColor(1000, 1360), "color-mix(in oklch, currentColor 50%, var(--orange))");
  assertEquals(ageColor(1000, 1600), "");
  assertEquals(ageColor(undefined, 1000), "");
});

Deno.test("cms.backend: link links http(s) only — a client-sent javascript: stays text", () => {
  assertEquals(String(link("https://a.ch/?x=1&y=2")), `<a href="https://a.ch/?x=1&amp;y=2" target=_blank>https://a.ch/?x=1&amp;y=2</a>`);
  assertEquals(String(link("javascript:alert(1)")), "javascript:alert(1)");
  assertEquals(String(link(null)), "");
});

Deno.test({
  name: "cms.backend: takeOver moves a renamed module's page where the new name says, one placed by hand stays",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const dir = await Deno.makeTempDir() + "/";
    const app = new App({ dir, db: `sqlite:${dir}site.sqlite` });
    app.stores.add(import.meta.resolve("../../store.json")).add("cms");
    await app.init();
    try {
      const cm = cms(app);
      const page = await install(app, "cms.backend.x.a", { en: "A" });
      const placed = await install(app, "cms.backend.x.b");
      const own = await install(app, "cms.backend.own");
      await own!.insertBefore(placed!);
      await takeOver(app, "cms.backend.x.a", "cms.backend.y.a");
      await takeOver(app, "cms.backend.x.b", "cms.backend.y.b");
      const y = await install(app, "cms.backend.y");

      assertEquals((await install(app, "cms.backend.y.a"))?.id, page?.id, "the page is kept, not created anew");
      assertEquals((await page!.parent())?.id, y?.id);
      assertEquals(await page!.title("en"), "A");
      assertEquals((await placed!.parent())?.id, own?.id, "a page placed by hand stays");
      assertEquals((await cm.nodesByModule("cms.backend.x.b")).size, 0);

      const top = await install(app, "cms.backend.x.c");
      await takeOver(app, "cms.backend.x.c", "cms.backend.c");
      assertEquals((await top!.parent())?.id, (await (await cm.nodeByModule("cms.backend"))?.page())?.id, "up to the top");
    } finally {
      await app.db.close();
      await Deno.remove(dir, { recursive: true });
    }
  },
});
