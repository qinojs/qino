import { requestStorage, type App, type Ctx } from "../core/mod.ts";
import { cmsCtx } from "../cms/mod.ts";
import { backend } from "../cms.backend/mod.ts";
import { hit } from "../score/mod.ts";

/** What this module scores, and with which half-life in seconds. */
export const TABLES: Record<string, number> = { page: 30 * 86400, file: 30 * 86400 };

/** A rendered page is one access to its node — not counted for error pages, the backend and bots. */
export function pageHit(app: App, ctx: Ctx): Promise<void> | undefined {
  const cms = cmsCtx(ctx);
  if (ctx.res.status !== 200 || cms.editmode || !cms.nodeId) return;
  if (backend.uaInfo(ctx.req.header("user-agent") ?? "").bot) return;
  return hit(app.db, "page", cms.nodeId);
}

/** `dbFile:access` is the permission hook and fires on mere checks too, so only the
 *  delivery route counts — that is the one request that really hands the file out. */
export function fileHit(app: App, id: number, access: boolean): Promise<void> | undefined {
  if (!access || !id) return;
  if (!requestStorage.getStore()?.req.appPath.startsWith("dbFile/")) return;
  return hit(app.db, "file", id);
}
