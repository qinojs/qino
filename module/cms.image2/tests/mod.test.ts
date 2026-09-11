// deno-lint-ignore-file no-explicit-any
import { requestStorage } from "@qino/qino";
import { assertEquals, testContext } from "@qino/qino/tests";

import { cms_image2 } from "../mod.ts";
import { imageData } from "../imageData.ts";

Deno.test("cms.image2: SVG dimensions use root attributes and viewBox", async () => {
  const dir = await Deno.makeTempDir();
  const path = dir + "/image.svg";
  const file = { path, get: () => "image/svg+xml", transform: () => ({ path }), url: () => "/original.svg" };
  try {
    for (const [attributes, w, h] of [
      ['viewBox="-10 0 400 200"', 400, 200],
      ['width="120" height="90" viewBox="0 0 400 200"', 120, 90],
      ['height="80" viewBox="0,0,400,200"', 160, 80],
      ['width="100%" height="100%" viewBox="0 0 400 200"', 400, 200],
      ['height="80px" width="120px"', 120, 80],
      ['height="1in" width="72pt" viewBox="0 0 400 200"', 400, 200],
      ['width="100" viewBox="0 0 0 0"', 800, 600],
      ['', 800, 600],
    ] as const) {
      await Deno.writeTextFile(path, `<!-- <svg width="999"> --><svg ${attributes}><svg width="999"/></svg>`);
      const data = await imageData(file as any, {}, dir + "/cache/");
      assertEquals([data.w, data.h], [w, h], attributes);
    }
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("cms.image2: finished SVGs use the requested quality inline and across display sizes", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const ctx = await testContext({ app: { modules: { get: () => ({ cache: dir + "/cache/" }) } } });
    const file = {
      path: dir + "/image.svg",
      get: (key: string) => ({ mime: "image/svg+xml", name: "logo.svg", md5: "svg" }[key]),
      url: (params?: unknown) => {
        assertEquals(params, { q: 37 });
        return "/dbFile/1/u-svg/q-37/logo.svg";
      },
      transform: (params: unknown) => {
        assertEquals(params, { q: 37 });
        return { path: dir + "/optimized.svg", mime: "image/svg+xml" };
      },
    };
    const source = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 200"><text>Grün</text></svg>';
    await Deno.writeTextFile(file.path, source.replace('</svg>', '<!--' + 'x'.repeat(4096) + '--></svg>'));
    await Deno.writeTextFile(dir + "/optimized.svg", source);
    const inline = String(await requestStorage.run(ctx, () => cms_image2(file as any, { width: 200, quality: 37, fit: "cover" })));
    assertEquals(inline.includes(' data-fixed-src'), false);
    assertEquals(inline.includes('style="--image-width:200px;--aspect-ratio:200/100"'), true);
    assertEquals(inline.includes('fit="cover"'), false);
    assertEquals(inline.includes('background-'), false);
    assertEquals(inline.includes('object-position'), false);
    assertEquals(inline.includes('src="data:image/svg+xml,' + encodeURIComponent(source) + '"'), true);

    await Deno.writeTextFile(dir + "/optimized.svg", source.replace('</svg>', '<!--' + 'x'.repeat(2048) + '--></svg>'));
    for (const [width, ratio] of [[100, "100/50"], [500, "400/200"]] as const) {
      const out = String(await requestStorage.run(ctx, () => cms_image2(file as any, { width, height: 200, fit: "contain", quality: 37 })));
      assertEquals(out.includes('src="/dbFile/1/u-svg/q-37/logo.svg"'), true);
      assertEquals(out.includes(`--aspect-ratio:${ratio}"`), true);
      assertEquals(out.includes('fit="contain"'), true);
      assertEquals(out.includes('data:image/png'), false);
    }
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("cms.image2: cms_image2 renders escaped image component from cached data", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await Deno.mkdir(dir + "/cache/cms.image2/", { recursive: true });
    const md5 = "abc123";
    const cacheFile = dir + `/cache/cms.image2/data-${md5}.45.55.320.180.42.30..json`;
    await Deno.writeTextFile(cacheFile, JSON.stringify({
      w: 320,
      h: 180,
      vpos: 45,
      hpos: 55,
      preview: "data:image/png;base64,preview",
    }));

    const ctx = await testContext({ app: { modules: { get: () => ({ cache: dir + "/cache/cms.image2/" }) } } });
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

    assertEquals(out.includes('<cms-image2 style="object-fit:cover;--image-width:320px;background-image:url(data:image/png;base64,preview);background-position:55% 45%;--aspect-ratio:320/180"'), true);
    assertEquals(out.includes('style="object-position:55% 45%"'), true);
    assertEquals(out.includes(' class="hero&quot;image"'), true);
    assertEquals(out.includes(' loading="lazy"'), true);
    assertEquals(out.includes('src="/dbFile?w=320&amp;h=180&amp;vpos=45&amp;hpos=55&amp;q=85"'), true);
    assertEquals(out.includes('alt="&lt;Alt&gt;"'), true);
    assertEquals([...ctx.res.html.legacyScripts], ["/m/cms.image2/pub/cms-image2.js"]);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("cms.image2: cms_image2 derives alt text from file name", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await Deno.mkdir(dir + "/cache/cms.image2/", { recursive: true });
    const md5 = "def456";
    const cacheFile = dir + `/cache/cms.image2/data-${md5}.50.50.100.50.42.30.contain.json`;
    await Deno.writeTextFile(cacheFile, JSON.stringify({
      w: 100,
      h: 50,
      vpos: 50,
      hpos: 50,
      preview: "",
    }));

    const ctx = await testContext({ app: { modules: { get: () => ({ cache: dir + "/cache/cms.image2/" }) } } });
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
