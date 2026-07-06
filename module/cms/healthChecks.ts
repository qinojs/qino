// deno-lint-ignore-file no-explicit-any
import type { HealthTypes } from "../cms.backend.system/healthRegistry.ts";

export function healthChecks(app: any): HealthTypes {
  const db       = app.db;
  const settings = app.settings;
  return {
    cleanup: {
      "pages in trash": async () => {
        const trashId = Number(await settings.cms?.pageTrash ?? 0);
        if (!trashId) return undefined;
        const count = Number(await db.one`SELECT count(*) FROM page WHERE basis = ${trashId}`);
        if (!count) return undefined;
        return {
          info: `There are ${count} items in the trash`,
          solutions: {
            "empty trash": {
              solve: async () => {
                const TrashNode = await app.cms.node(trashId);
                for (const Child of (await TrashNode.children({ type: "*" })).values()) {
                  await TrashNode.removeChild(Child);
                }
              },
            },
          },
        };
      },
    },
    notice: {
      "pages with no parent": async () => {
        const all = await db.col`SELECT p.id FROM page p LEFT JOIN page pp ON p.basis = pp.id WHERE pp.id IS NULL AND p.basis != 0`;
        if (!all.length) return undefined;
        return {
          info: `There are ${all.length} pages with no parent`,
          solutions: {
            "move to trash": {
              solve: async () => {
                const trashId = Number(await settings.cms?.pageTrash ?? 0);
                if (!trashId) throw new Error("No trash page configured");
                const TrashNode = await app.cms.node(trashId);
                const trashCont = await TrashNode.cont("main");
                for (const pid of all) {
                  const P = await app.cms.node(Number(pid));
                  await TrashNode.insertBefore(P, trashCont);
                }
              },
            },
          },
        };
      },
    },
  };
}
