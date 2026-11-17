import { test } from "node:test";
import { FileTransformer } from "@qino/qino";
import { assert, assertStringIncludes, fakeT } from "@qino/qino/tests";

import { cms } from "../plugin.ts";

const file = (mime: string, url: string) => ({ mime, url: (p?: { frame?: number }) => p?.frame ? `${url}#${p.frame}.jpg` : url });
const fake = (files: ReturnType<typeof file>[], settings: Record<string, unknown> = {}, edit = false) => ({
  app: { t: fakeT },
  edit: () => edit,
  files: () => new Map(files.map((f, i) => [String(i), f])),
  settings: new Proxy({}, { get: (_, k) => () => settings[k as string] }),
}) as never;
const render = async (node: never) => String(await cms.node.render(node));

test("cms.cont.video: the first video plays, the first image is the poster", async () => {
  const out = await render(fake([file("image/jpeg", "p.jpg"), file("video/mp4", "a.mp4"), file("video/mp4", "b.mp4")]));
  assertStringIncludes(out, `<video controls playsinline preload=metadata poster="p.jpg">`);
  assertStringIncludes(out, `<source src="a.mp4" type="video/mp4">`);
  assert(!out.includes("b.mp4"));
});

test("cms.cont.video: autoplay is always muted and preloads", async () => {
  const out = await render(fake([file("video/webm", "a.webm")], { autoplay: true, controls: false, loop: true }));
  assertStringIncludes(out, "<video autoplay muted loop playsinline preload=auto");
});

test("cms.cont.video: without an image the first frame is the poster, if ffmpeg can cut it", async () => {
  const out = await render(fake([file("video/mp4", "a.mp4")]));
  if (await FileTransformer.capabilities.ffmpeg) assertStringIncludes(out, `poster="a.mp4#1.jpg"`);
  else assert(!out.includes("poster"));
});

test("cms.cont.video: without a video only editors see a hint", async () => {
  assert(!(await render(fake([]))).includes("Drop"));
  assertStringIncludes(await render(fake([], {}, true)), "Drop a video file here.");
});
