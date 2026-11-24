import { test } from "node:test";
import { FileTransformer } from "@qino/qino";
import { assert, assertStringIncludes, testContext } from "@qino/qino/tests";

import { cms } from "../plugin.ts";

const file = (mime: string, url: string) => ({ mime, url: (p?: { frame?: number }) => p?.frame ? `${url}#${p.frame}.jpg` : url });
const fake = (files: ReturnType<typeof file>[]) => ({
  id: 1,
  files: () => new Map(files.map((f, i) => [String(i), f])),
  settings: new Proxy({}, { get: () => () => undefined }),
}) as never;

test("cms.cont.gallery.masonry: a video plays among the pictures like a moving photo", async () => {
  const ctx = await testContext();
  const out = String(await cms.node.render(fake([file("video/mp4", "a.mp4"), file("application/pdf", "b.pdf")]), { ctx }));
  assertStringIncludes(out, `<video src="a.mp4" autoplay muted loop playsinline preload=metadata`);
  if (await FileTransformer.capabilities.ffmpeg) assertStringIncludes(out, `poster="a.mp4#1.jpg"`);
  assert(!out.includes("b.pdf"), "other files stay out");
});
