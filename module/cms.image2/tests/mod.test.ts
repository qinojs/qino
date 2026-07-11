// deno-lint-ignore-file no-explicit-any
import { assertEquals, testContext } from "../../core/tests/deps.ts";
import { cms_image2 } from "../mod.ts";
import { requestStorage } from "../../core/mod.ts";

Deno.test("cms.image2: cms_image2 renders escaped image component from cached data", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await Deno.mkdir(dir + "/cache/");
    const md5 = "abc123";
    const cacheFile = dir + `/cache/cms-image2-data-${md5}.45.55.320.180.42.30..json`;
    await Deno.writeTextFile(cacheFile, JSON.stringify({
      w: 320,
      h: 180,
      vpos: 45,
      hpos: 55,
      preview: "data:image/png;base64,preview",
    }));

    const ctx = await testContext({ app: { appPATH: dir + "/" } });
    const dbFile = {
      path: dir + "/image.jpg",
      get: (key: string) => ({
        md5,
        vpos: 45,
        hpos: 55,
        name: "hello_world.jpg",
      }[key]),
      url: (params: Record<string, unknown>) => "/dbFile?" + new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString(),
    };

    const out = String(await requestStorage.run(ctx, () => cms_image2(dbFile as any, {
      width: 320,
      height: 180,
      alt: `<Alt>`,
      class: `hero"image`,
      loading: "lazy",
      css: { "object-fit": "cover" },
    })));

    assertEquals(out.includes('<cms-image2 style=";object-fit:cover; max-width:320px; background-image:url(data:image/png;base64,preview); background-position:55% 45%; --aspect-ratio:0.5625; "'), true);
    assertEquals(out.includes(' class="hero&quot;image"'), true);
    assertEquals(out.includes(' loading="lazy"'), true);
    assertEquals(out.includes('src="/dbFile?w=320&amp;h=180&amp;vpos=45&amp;hpos=55&amp;q=85"'), true);
    assertEquals(out.includes('alt="&lt;Alt&gt;"'), true);
    assertEquals([...ctx.html.legacyScripts], ["/m/cms.image2/pub/cms-image2.js"]);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("cms.image2: cms_image2 derives alt text from file name", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await Deno.mkdir(dir + "/cache/");
    const md5 = "def456";
    const cacheFile = dir + `/cache/cms-image2-data-${md5}.50.50.100.50.42.30.contain.json`;
    await Deno.writeTextFile(cacheFile, JSON.stringify({
      w: 100,
      h: 50,
      vpos: 50,
      hpos: 50,
      preview: "",
    }));

    const ctx = await testContext({ app: { appPATH: dir + "/" } });
    const dbFile = {
      path: dir + "/image.jpg",
      get: (key: string) => ({
        md5,
        vpos: 50,
        hpos: 50,
        name: "product_photo.webp",
      }[key]),
      url: (params: Record<string, unknown>) => "/dbFile?" + new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString(),
    };

    const out = String(await requestStorage.run(ctx, () => cms_image2(dbFile as any, {
      width: 100,
      height: 50,
      fit: "contain",
    })));

    assertEquals(out.includes("max=true"), true);
    assertEquals(out.includes('alt="Product Photo"'), true);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
