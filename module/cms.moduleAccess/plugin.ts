import { sql, type App } from "../core/mod.ts";

export const name = "cms.moduleAccess";
export const needs = ["cms"];

export const dbSchema = {
  properties: {
    cms_module_access_grp: {
      additionalProperties: {
        properties: {
          module: {
            type: "string",
            maxLength: 127,
            "x-index": "primary",
            "x-qg-parent": "module",
            "x-qg-on-parent-delete": "cascade",
          },
          grp_id: {
            type: "integer",
            "x-index": "primary",
            "x-qg-parent": "grp",
            "x-qg-on-parent-delete": "cascade",
          },
          access: {
            type: "integer",
            minimum: 0,
            maximum: 3,
            default: 0,
          },
        },
        required: ["module", "grp_id", "access"],
      },
    },
  },
};

export function init(app: App): void {
  app.on("node:access", async (e) => {
    if (!e.access || !e.user) return;
    if (await e.user.get("superuser")) return;

    const module = String(e.node.module?.name ?? "");
    if (!module) return;

    const grps: number[] = (await e.user.grps?.() ?? []).map(Number).filter(Boolean);
    if (!grps.length) return;

    const cap = await app.db.one`
      SELECT max(access) FROM cms_module_access_grp
      WHERE module = ${module}
        AND grp_id IN (${sql.join(grps.map((g) => sql`${g}`))})`;
    if (cap !== undefined && cap !== null) e.access = Math.min(e.access, Number(cap) || 0);
  });
}
