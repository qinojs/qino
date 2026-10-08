import { errMsg } from "@qino/qino";
import { backend } from "@qino/qino/cms.backend";

import { read } from "./lib/read.ts";

import type { Node } from "@qino/qino/cms";

type Sent = { name: string; type: string; data: string };

/** Node access is the permission — whoever may open this page may read invoices in. */
export default async function api(node: Node, vars: Record<string, unknown>): Promise<unknown> {
  const app = node.app;
  const t = app.t;
  if (!vars.read) return null;
  const done: number[] = [];
  const failed: string[] = [];
  // one after the other: each is a call to the model, and one failure leaves the others
  for (const sent of vars.read as Sent[]) {
    try {
      const bytes = Uint8Array.fromBase64(String(sent.data));
      const file = await app.dbFiles.add(new File([bytes], sent.name || "invoice", { type: sent.type }));
      // a file that could not be read is no receipt of anything
      done.push(await read(app, file).catch(async (e) => {
        await file.remove();
        throw e;
      }));
    } catch (e) {
      failed.push(`${sent.name}: ${errMsg(e)}`);
    }
  }
  const message = [`${done.length} ${await t`read`}`, ...failed].join("\n");
  // one invoice: straight to it
  if (done.length === 1 && !failed.length) {
    const url = (await backend.toModuleUrl(node, "cms.backend.superuser.fin.invoice"))({ invoice: done[0] });
    if (url) return { ok: true, url };
  }
  return { ok: !failed.length || done.length > 0, message };
}
