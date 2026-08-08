import { getCtx, isTrustedOrigin, safeEqual } from "../../core/mod.ts";

/** POST body as render vars, if this node is the one the form addressed. Counterpart of `cms.formFields()`. */
export function postedVars(nodeId: number): Record<string, any> | undefined {
  const ctx = getCtx();
  if (ctx.req.method !== "POST") return;
  const body = ctx.req.body;
  if (!body || typeof body !== "object" || Number(body["qcms-node"]) !== nodeId) return;
  if (!isTrustedOrigin(ctx.req) || !safeEqual(body.csrfToken, ctx.csrfToken)) {
    console.warn(`[cms] form post to node ${nodeId} rejected (origin/csrf)`);
    return;
  }
  const { "qcms-node": _node, csrfToken: _token, ...vars } = body;
  return vars;
}
