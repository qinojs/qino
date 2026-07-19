import { sql, type App, type dbEntry_usr } from "../core/mod.ts";

export const name = "cms.accessRules";
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

/** Access ceiling for a user on a module, or undefined = no cap. Caps node-bezug downward.
 *  Only cms users (a group with cms_access) get capped — the layer stays inert for plain
 *  frontend users and sites without cms groups. Per group: cms_access is a hard ceiling, a
 *  module override can only lower it further; the most permissive group wins. */
async function moduleCap(app: App, module: string, user: dbEntry_usr): Promise<number | undefined> {
  const grps: number[] = (await user.grps?.() ?? []).map(Number).filter(Boolean);
  if (!grps.length) return;
  const rows = await app.db.query`
    SELECT grp.cms_access AS cap, mag.access AS override
    FROM grp LEFT JOIN cms_module_access_grp mag ON mag.grp_id = grp.id AND mag.module = ${module}
    WHERE grp.id IN (${sql.join(grps.map((x) => sql`${x}`))})`;
  let cap: number | undefined;
  for (const r of rows) {
    const g = Number(r.cap) || 0; // 0/null = group irrelevant → no cap
    if (!g) continue;
    const perGroup = r.override == null ? g : Math.min(g, Number(r.override)); // override can't exceed the cap
    cap = cap === undefined ? perGroup : Math.max(cap, perGroup);
  }
  if (cap === undefined) return;
  const ceil = await app.db.one`SELECT cms_access FROM module WHERE name = ${module}`;
  return ceil == null ? cap : Math.min(cap, Number(ceil));
}

export function init(app: App): void {
  // cap the node access by the module axis
  app.on("node:access", async (e) => {
    if (!e.access || !e.user || await e.user.get("superuser")) return;
    const module = String(e.node.module?.name ?? "");
    if (!module) return;
    const cap = await moduleCap(app, module, e.user);
    if (cap != null) e.access = Math.min(e.access, cap);
  });

  // module picker: lower e.access to what the user may do with this module
  app.on("module:access", async (e) => {
    if (!e.user || await e.user.get("superuser")) return;
    const cap = await moduleCap(app, String(e.module), e.user);
    if (cap != null) e.access = Math.min(e.access, cap);
  });
}
