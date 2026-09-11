// deno-lint-ignore-file no-explicit-any
import { Parser } from "htmlparser2";
import { requestStorage } from "@qino/qino";
import { assertEquals, testContext } from "@qino/qino/tests";

import { cms } from "../plugin.ts";

Deno.test("cms-image2 test: every case includes a native image with its own size and layout options", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const path = dir + "/image.svg";
    await Deno.writeTextFile(path, '<svg viewBox="0 0 400 200"/>');
    const file = {
      get: (key: string) => ({ mime: "image/svg+xml", name: "image.svg", hpos: 25, vpos: 75 }[key]),
      exists: () => true,
      url: () => "/original.svg",
      transform: () => ({ path }),
    };
    const node = { settings: {}, file: () => file, edit: () => false };
    const ctx = await testContext({ app: { modules: { get: () => ({ cache: dir + "/cache/" }) } } });
    const out = String(await requestStorage.run(ctx, () => cms.node.render(node as any)));
    const natives: Record<string, string>[] = [];
    let cases = 0;
    new Parser({ onopentag(name, attrs) {
      if ("data-c2t-case" in attrs) cases++;
      if (name === "img" && attrs.class === "c2t-native-image") natives.push(attrs);
    } }).end(out);
    assertEquals(cases, 15);
    assertEquals(natives.length, cases);
    assertEquals(natives.every((img) => img.src === "/original.svg"), true);
    assertEquals([natives[1].width, natives[1].height], ["360", "220"]);
    assertEquals(natives[2].style.includes("object-fit:contain"), true);
    assertEquals([natives[3].width, natives[3].height], ["360", undefined]);
    assertEquals([natives[4].width, natives[4].height], [undefined, "220"]);
    assertEquals([natives[5].width, natives[5].height], [undefined, undefined]);
    assertEquals(natives[7].style.includes("object-position:0% 0%"), true);
    assertEquals(natives[8].style.includes("object-position:100% 100%"), true);
    assertEquals(natives[9].style.includes("flex:1 1 auto"), true);
    assertEquals(natives[14].style.includes("max-width:120px"), true);
    for (const width of [240, 480]) {
      const lab = String(await requestStorage.run(ctx, () => cms.node.parts.lab(node as any, { vars: { lab: { width } } })));
      assertEquals(lab.includes(`--image-width:${width}px`), true);
      assertEquals(lab.includes(`width="${width}"`), true);
    }
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
