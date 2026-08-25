import { errMsg } from "@qino/qino";
import { templated } from "@qino/qino/messaging";

import { sampleMsg, sampleValues } from "./render.ts";

import type { Node } from "@qino/qino/cms";

/** Node access is the permission — the preview renders, it stores nothing. */
export default async function api(node: Node, vars: Record<string, unknown>): Promise<unknown> {
  if (!vars.preview) return null;
  const app = node.app;
  try {
    const { text, format, channel } = vars.preview as Record<string, string>;
    const wanted = format === "md" || format === "html" ? format : undefined;
    const render = templated({ text: String(text ?? ""), format: wanted }, await sampleMsg(app, wanted),
      channel === "telegram" ? "telegram" : "html");
    return { ok: true, ...render(await sampleValues(app)) };
  } catch (e) {
    return { ok: false, message: errMsg(e) };
  }
}
