import { $item, App } from "@qino/qino";
import { assertEquals, assertStringIncludes } from "@qino/qino/tests";

async function testApp(): Promise<{ app: App; dir: string }> {
  const dir = await Deno.makeTempDir() + "/";
  const app = new App({ db: "sqlite::memory:", dir: dir, appUrl: "/site/" });
  app.stores.add(import.meta.resolve("../../store.json")).add("webapp");
  await app.init();
  const identity = app.settings[$item].sub(["identity"]);
  await identity.sub("name").set("Portal");
  await identity.sub("alternateName").set("Short");
  await identity.sub("description").set("Portal description");
  await identity.sub(["brand", "primaryColor"]).set("#123456");
  await identity.sub(["brand", "backgroundColor"]).set("#ffffff");
  return { app, dir };
}

async function close(app: App, dir: string): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 100));
  await app.db.close();
  await Deno.remove(dir, { recursive: true });
}

Deno.test("webapp serves an extensible manifest with identity defaults and validators", async () => {
  const { app, dir } = await testApp();
  try {
    const settings = app.settings[$item].sub(["webapp"]);
    await settings.sub("display").set("standalone");
    await settings.sub("orientation").set("portrait");
    await settings.sub("categories").set("Business\nProductivity\nbusiness");
    app.on("webapp:manifest", ({ manifest }) => { manifest.shortcuts = [{ name: "Inbox", url: "inbox" }]; });

    const res = await app.fetch(new Request("https://qino.test/site/manifest.webmanifest"));
    const data = await res.json();
    assertEquals(res.status, 200);
    assertEquals(res.headers.get("content-type"), "application/manifest+json; charset=utf-8");
    assertEquals(res.headers.get("cache-control"), "no-cache");
    assertEquals(data, {
      name: "Portal",
      short_name: "Short",
      description: "Portal description",
      id: "/site/",
      scope: "/site/",
      start_url: "/site/",
      display: "standalone",
      orientation: "portrait",
      theme_color: "#123456",
      background_color: "#ffffff",
      categories: ["business", "productivity"],
      shortcuts: [{ name: "Inbox", url: "inbox" }],
    });

    const cached = await app.fetch(new Request("https://qino.test/site/manifest.webmanifest", {
      headers: { "If-None-Match": res.headers.get("etag")! },
    }));
    assertEquals(cached.status, 304);
    assertEquals(await cached.text(), "");
  } finally {
    await close(app, dir);
  }
});

Deno.test("webapp adds browser metadata and conventional icon routes", async () => {
  const { app, dir } = await testApp();
  try {
    const settings = app.settings[$item].sub(["webapp"]);
    await settings.sub("telephoneDetection").set(false);
    await settings.sub("display").set("standalone");
    await settings.sub("appleStatusBarStyle").set("black-translucent");
    const icon = await app.dbFiles.add("data:image/svg+xml;name=icon.svg;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=");
    await icon.access(true);
    await app.db.table("identity_file").ensure({ name: "icon", file_id: icon.id });
    app.on("render", ({ ctx }) => { ctx.res.html.content = "<main>ok</main>"; });

    const res = await app.fetch(new Request("https://qino.test/site/"));
    const out = await res.text();
    assertStringIncludes(out, '<link href="/site/manifest.webmanifest" rel="manifest">');
    assertEquals(out.includes('name="application-name"'), false);
    assertStringIncludes(out, '<meta name="theme-color" content="#123456">');
    assertStringIncludes(out, '<meta name="format-detection" content="telephone=no">');
    assertStringIncludes(out, '<meta name="SKYPE_TOOLBAR" content="SKYPE_TOOLBAR_PARSER_COMPATIBLE">');
    assertStringIncludes(out, '<meta name="apple-mobile-web-app-capable" content="yes">');
    assertEquals(out.includes('name="mobile-web-app-capable"'), false);
    assertStringIncludes(out, '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">');
    assertStringIncludes(out, 'rel="apple-touch-icon"');

    const manifest = await (await app.fetch(new Request("https://qino.test/site/manifest.webmanifest"))).json();
    assertEquals(manifest.icons[0].type, "image/svg+xml");
    assertEquals(manifest.icons[0].sizes, "any");

    const favicon = await app.fetch(new Request("https://qino.test/site/favicon.ico"));
    assertEquals(favicon.status, 302);
    assertStringIncludes(favicon.headers.get("location") ?? "", "/site/dbFile/");
  } finally {
    await close(app, dir);
  }
});

Deno.test("webapp omits standalone metadata in browser mode", async () => {
  const { app, dir } = await testApp();
  try {
    app.on("render", ({ ctx }) => { ctx.res.html.content = "<main>ok</main>"; });
    const out = await (await app.fetch(new Request("https://qino.test/site/"))).text();
    assertEquals(out.includes('name="apple-mobile-web-app-capable"'), false);
  } finally {
    await close(app, dir);
  }
});
