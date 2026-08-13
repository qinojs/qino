import type { HealthTypes } from "@qino/qino/cms.backend.system";
import type { App } from "@qino/qino";
import { cms } from "./lib/CMS.ts";

export function healthChecks(app: App): HealthTypes {
  const db       = app.db;
  const settings = app.settings;
  return {
    cleanup: {
      "pages in trash": async () => {
        const trashId = Number(await settings.cms?.pageTrash);
        if (!trashId) return;
        const count = Number(await db.one`SELECT count(*) FROM page WHERE basis = ${trashId}`);
        if (!count) return;
        return {
          info: `There are ${count} items in the trash`,
          solutions: {
            "empty trash": {
              solve: async () => {
                const trashNode = await cms(app).node(trashId);
                for (const child of (await trashNode.children({ type: "*" })).values()) {
                  await trashNode.removeChild(child);
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
        if (!all.length) return;
        return {
          info: `There are ${all.length} pages with no parent`,
          solutions: {
            "move to trash": {
              solve: async () => {
                const trashId = Number(await settings.cms?.pageTrash);
                if (!trashId) throw new Error("No trash page configured");
                const trashNode = await cms(app).node(trashId);
                const trashCont = await trashNode.cont("main");
                for (const pid of all) {
                  const p = await cms(app).node(Number(pid));
                  await trashNode.insertBefore(p, trashCont);
                }
              },
            },
          },
        };
      },
    },
  };
}
