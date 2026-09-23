import { requestStorage } from "@qino/qino";
import { cmsCtx } from "@qino/qino/cms";
import { backend } from "@qino/qino/cms.backend";
import { hit } from "@qino/qino/score";

import type { App, Ctx } from "@qino/qino";

/** What this module scores, and with which half-life in seconds. */
export const TABLES: Record<string, number> = { page: 30 * 86400, file: 30 * 86400 };

/** A rendered page is one access to its node — not counted for error pages, the backend and bots. */
export function pageHit(app: App, ctx: Ctx): Promise<void> | undefined {
  const cms = cmsCtx(ctx);
  if (ctx.res.status !== 200 || cms.editmode || !cms.nodeId) return;
  if (backend.uaInfo(ctx.req.header("user-agent") ?? "").bot) return;
  return hit(app.db, "page", cms.nodeId);
}

/** `dbFile:access` also fires on permission checks, so only the delivery route counts. */
export function fileHit(app: App, id: number, access: boolean): Promise<void> | undefined {
  if (!access || !id) return;
  if (!requestStorage.getStore()?.req.appPath.startsWith("dbFile/")) return;
  return hit(app.db, "file", id);
}
