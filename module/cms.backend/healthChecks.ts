import { cms } from "@qino/qino/cms";

import type { App } from "@qino/qino";
import type { Node } from "@qino/qino/cms";
import type { HealthChecks } from "@qino/qino/cms.backend.system";

/**
 * Backend pages are protected purely via node access (groups/users), not via
 * code guards. This errors when a backend page is reachable by any logged-in
 * user who is in no group at all — i.e. the page's effective access is > 0
 * without requiring a specific group.
 */
export function healthChecks(app: App): HealthChecks {
  const db = app.db;
  return {
    error: {
      "backend reachable without group": async () => {
        const open = [];
        for (const page of Object.values(await backendPages(app))) {
          // effective access for a logged-in user that is in no group:
          // only the page's own access value (resolved through inheritance),
          // no group/user boost from page_access_grp/usr.
          const access = await ownAccess(page);
          if (access >= 1) open.push(String(page));
        }
        if (!open.length) return;
        return {
          info: `${open.length} backend page(s) are accessible to any logged-in user (no group required): ${open.join(", ")}`,
        };
      },
    },
  };

  /** All page nodes whose module is part of the backend. */
  async function backendPages(app: App): Promise<Record<string, Node>> {
    const rows = await db.query`SELECT id FROM page WHERE module LIKE 'cms.backend%' OR module = 'cms.layout.backend'`;
    const ret: Record<string, Node> = {};
    for (const row of rows) ret[row.id] = await cms(app).node(Number(row.id));
    return ret;
  }
}

/** Page access for a logged-in user without any group: only the inherited own access. */
async function ownAccess(node: Node): Promise<number> {
  if (node.vs.access === null) {
    const parent = await node.parent();
    return parent ? ownAccess(parent) : 0;
  }
  return Number(node.vs.access) || 0;
}
