import { sql, type App, type dbEntry_usr } from "../core/mod.ts";
import { standards } from "./lib/standards.ts";

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

/** Module-axis access for a user (or guest), or undefined = no rule at all.
 *  module.cms_access is the default for everyone (0 = module off, null = no rule);
 *  a group override replaces that default — but never exceeds the group's cms_access
 *  cap. The most permissive group wins. */
async function moduleCap(app: App, module: string, user?: dbEntry_usr | null): Promise<number | undefined> {
  const std = (await standards(app)).get(module); // undefined = no rule
  const base = std ?? 3;
  const grps = user ? (await user.grps?.() ?? []).map(Number).filter(Boolean) : [];
  let cap = std; // the default applies to everyone, groups can only improve on it
  if (grps.length) {
    const rows = await app.db.query`
      SELECT grp.cms_access AS cap, mag.access AS override
      FROM grp LEFT JOIN cms_module_access_grp mag ON mag.grp_id = grp.id AND mag.module = ${module}
      WHERE grp.id IN (${sql.join(grps.map((x) => sql`${x}`))})`;
    for (const r of rows) {
      const g = Number(r.cap) || 0; // 0/null = group irrelevant for the module axis
      if (!g) continue;
      const perGroup = Math.min(g, r.override == null ? base : Number(r.override));
      cap = cap === undefined ? perGroup : Math.max(cap, perGroup);
    }
  }
  return cap;
}

export function init(app: App, { signal }: { signal: AbortSignal }): void {
  // cap the node access by the module axis; a logged-in user never ends up
  // below the guest baseline of the node (deny standard = 0 for guests too).
  app.on("node:access", async (e) => {
    if (!e.access) return;
    if (e.user && await e.user.get("superuser")) return;
    const module = String(e.node.module?.name ?? "");
    if (!module) return;
    const cap = await moduleCap(app, module, e.user);
    if (cap == null) return;
    if (!e.user) { e.access = Math.min(e.access, cap); return; }
    const guest = (await standards(app)).get(module) === 0 ? 0 : (await e.node.isPublic()) ? 1 : 0;
    e.access = Math.max(Math.min(e.access, cap), guest);
  }, { signal });

  // module picker/add: lower e.access to what the user may do with this module
  app.on("module:access", async (e) => {
    if (e.user && await e.user.get("superuser")) return;
    const cap = await moduleCap(app, String(e.module), e.user);
    if (cap != null) e.access = Math.min(e.access, cap);
  }, { signal });
}
