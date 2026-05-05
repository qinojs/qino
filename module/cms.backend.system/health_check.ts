/**
 * cms.backend.system/health_check.ts
 * Port of cms.backend.system/health_check.php
 */

// deno-lint-ignore-file no-explicit-any

import { hee } from "../core/lib/util.ts";


export type Solution = {
  form?: Record<string, any>;
  solve: (formData?: Record<string, any>) => Promise<any> | any;
};

export type CheckResult = {
  info?: string;
  solutions?: Record<string, Solution>;
} | undefined;

export type CheckFn = () => Promise<CheckResult> | CheckResult;

export type HealthTypes = Record<string, Record<string, CheckFn>>;

export async function getTypes(app: any): Promise<HealthTypes> {
  const db = app.db;
  const ctx = app._lastCtx ?? {};
  const settings = app.settings;

  const types: HealthTypes = {
    error:   {},
    warning: {},
    notice:  {},
    cleanup: {},
    repair:  {},
  };

  // ── duplicate settings ──────────────────────────────────────────────────
  const dupRows = await db.all(
    "SELECT `offset`, basis, count(id) as count FROM qg_setting GROUP BY basis, `offset` HAVING count(id) > 1"
  );
  for (const row of dupRows) {
    const basis  = row.basis;
    const offset = row.offset;
    types.warning[`duplicate settings "${offset}" basis:${basis}`] = async () => {
      const solutions: Record<string, Solution> = {};
      solutions["remove all without value"] = {
        solve: async () => {
          await db.query(
            "DELETE FROM qg_setting WHERE basis=? AND `offset` = ? AND value = ''", [basis, offset]
          );
        },
      };
      const rows = await db.all(
        "SELECT * FROM qg_setting WHERE basis=? AND `offset` = ?", [basis, offset]
      );
      for (const r of rows) {
        const countChilds = await db.one("SELECT count(*) FROM qg_setting WHERE basis=?", [r.id]);
        solutions[`remove ${r.id} value:"${r.value}" childs:${countChilds}`] = {
          solve: async () => {
            await db.query("DELETE FROM qg_setting WHERE id = ?", [r.id]);
          },
        };
      }
      return { solutions };
    };
  }

  // ── htaccess protection ─────────────────────────────────────────────────
  types.error["htaccess protection disabled"] = async () => {
    const scheme = ctx.server?.SCHEME ?? "https";
    const host   = ctx.server?.SERVER_NAME ?? "";
    const sysURL = ctx.sysURL ?? "";
    const urls = [
      `${scheme}://${host}${sysURL}qg/index.json`,
    ];
    let info = "";
    for (const url of urls) {
      try {
        const res = await fetch(url, { redirect: "manual" });
        if (res.status !== 403) info += `<br>Accessible: ${hee(url)}`;
      } catch { /* network error counts as not accessible */ }
    }
    if (!info) return undefined;
    return { info: "Not htaccess protected!" + info };
  };

  // ── superuser default password ──────────────────────────────────────────
  types.error["superuser default password"] = async () => {
    const usrs = await db.all("SELECT * FROM usr WHERE pw != '' ORDER BY superuser DESC, email = 'su' DESC, id LIMIT 20");
    const found: any[] = [];
    let info = "";
    for (const row of usrs) {
      // bcrypt check: password "su"
      const { compare } = await import("https://deno.land/x/bcrypt@v0.4.1/mod.ts");
      let match = false;
      try { match = await compare("su", row.pw); } catch { /* skip */ }
      if (!match) continue;
      found.push(row);
      info += hee(row.email) + "<br>";
    }
    if (!found.length) return undefined;
    return {
      info: info + " es wurden nur die ersten 20 geprüft",
      solutions: {
        "remove pw": {
          solve: async () => {
            for (const row of found) {
              await db.query("UPDATE usr SET pw='' WHERE id=?", [row.id]);
            }
          },
        },
        "remove user": {
          solve: async () => {
            for (const row of found) {
              await db.query("DELETE FROM usr WHERE id=?", [row.id]);
            }
          },
        },
      },
    };
  };

  // ── mail from domain ────────────────────────────────────────────────────
  types.notice['default "mail from" is not in this domain'] = async () => {
    const host   = ctx.server?.HTTP_HOST ?? "";
    const domain = host.replace(/^www\./, "");
    const value  = String(await settings.qg?.mail?.defSender ?? "");
    if (value.endsWith("@" + domain)) return undefined;
    return {
      info: "its: " + hee(value),
      solutions: {
        [`set it to: info@${domain}`]: {
          solve: async () => { settings.qg.mail.defSender = "info@" + domain; },
        },
      },
    };
  };

  types.notice['mail "replay" not from this domain'] = async () => {
    const host   = ctx.server?.HTTP_HOST ?? "";
    const domain = host.replace(/^www\./, "");
    const value  = String(await settings.qg?.mail?.replay ?? "");
    if (value.endsWith("@" + domain)) return undefined;
    return {
      info: "its: " + hee(value),
      solutions: {
        [`set it to: info@${domain}`]: {
          solve: async () => { settings.qg.mail.replay = "info@" + domain; },
        },
      },
    };
  };

  types.notice["no mail recipient on debug mode"] = async () => {
    if (await settings.qg?.mail?.["on debugmode to"]) return undefined;
    const usr = ctx.usr;
    if (!usr?.superuser) return undefined;
    return {
      solutions: {
        [`set it to: ${hee(usr.email)}`]: {
          solve: async () => { settings.qg.mail["on debugmode to"] = usr.email; },
        },
      },
    };
  };

  types.warning["smalltexts-counter is enabled"] = async () => {
    if (!await settings.qg?.smalltext?.counter) return undefined;
    if (!ctx.usr?.superuser) return undefined;
    return {
      solutions: {
        disable: { solve: async () => { settings.qg.smalltext.counter = 0; } },
      },
    };
  };

  types.warning["smalltext code-logger is enabled"] = async () => {
    if (!await settings.qg?.smalltext?.code_logger) return undefined;
    if (!ctx.usr?.superuser) return undefined;
    return {
      solutions: {
        disable: { solve: async () => { settings.qg.smalltext.code_logger = 0; } },
      },
    };
  };

  types.warning["users with old password-hash"] = async () => {
    const usrs = await db.col(
      "SELECT email FROM usr WHERE active AND email != '' AND email IS NOT NULL AND pw != '' AND pw NOT LIKE '$%' LIMIT 1000"
    );
    if (!usrs.length) return undefined;
    return {
      info: usrs.map((e: string) => hee(e)).join("<br>"),
      solutions: {
        "todo: ": { solve: async () => "nothing" },
      },
    };
  };

  // ── debug / https ───────────────────────────────────────────────────────
  types.notice["debugmode is active"] = async () => {
    if (!app.debug) return undefined;
    return { info: "change it in the app config" };
  };

  types.warning["https not enforced"] = async () => {
    if (app.httpsEnforced) return undefined;
    return { info: 'set QG_HTTPS=true in app config' };
  };

  // ── db-time vs os-time ──────────────────────────────────────────────────
  types.notice["db-time unlike os-time"] = async () => {
    const dbTime = Number(await db.one("SELECT UNIX_TIMESTAMP() as time"));
    const osTime = Math.floor(Date.now() / 1000);
    if (dbTime === osTime) return undefined;
    return {
      info: `db: ${new Date(dbTime * 1000).toISOString()}<br>os: ${new Date(osTime * 1000).toISOString()}<br>Machen Sie etwas...`,
    };
  };

  // ── texts with no lang ──────────────────────────────────────────────────
  types.notice["texts with no lang"] = async () => {
    const num = Number(await db.one("SELECT count(*) FROM text WHERE lang = ''"));
    if (!num) return undefined;
    return {
      info: `Found ${num}`,
      solutions: {
        delete: {
          solve: async () => { await db.query("DELETE FROM text WHERE lang = ''"); },
        },
      },
    };
  };

  // ── orphaned settings ───────────────────────────────────────────────────
  const installedModules = app.modules.all();
  const skipModules = new Set(["app1", "client1", "m", "qg"]);
  const allSettings: any = settings;
  if (allSettings) {
    for (const module of Object.keys(allSettings)) {
      if (skipModules.has(module)) continue;
      if (installedModules[module]) continue;
      types.notice[`settings needed :${module}`] = () => ({
        info: "did you deinstall the module?",
        solutions: {
          delete: {
            solve: async () => { delete allSettings[module]; },
          },
        },
      });
    }
  }

  // ── cache cleanup ───────────────────────────────────────────────────────
  const cacheDir = app.appPATH + "cache/";
  const twoDays  = 60 * 60 * 24 * 2 * 1000;

  async function countCacheFiles(dir: string, maxAge: number): Promise<number> {
    let i = 0;
    try {
      for await (const entry of Deno.readDir(dir)) {
        if (entry.name.startsWith(".")) continue;
        const full = dir + entry.name;
        if (entry.isDirectory) {
          i += await countCacheFiles(full + "/", maxAge);
        } else {
          const stat = await Deno.stat(full);
          if ((stat.atime?.getTime() ?? 0) < Date.now() - maxAge) i++;
        }
        if (i > 100) break;
      }
    } catch { /* dir may not exist */ }
    return i;
  }

  async function deleteCacheFiles(dir: string, maxAge: number): Promise<number> {
    let size = 0;
    try {
      for await (const entry of Deno.readDir(dir)) {
        if (entry.name.startsWith(".")) continue;
        const full = dir + entry.name;
        if (entry.isDirectory) {
          size += await deleteCacheFiles(full + "/", maxAge);
        } else {
          const stat = await Deno.stat(full);
          if ((stat.atime?.getTime() ?? 0) < Date.now() - maxAge) {
            size += stat.size;
            await Deno.remove(full);
          }
        }
      }
    } catch { /* skip */ }
    return size;
  }

  types.cleanup["delete cache"] = async () => {
    const i = await countCacheFiles(cacheDir, twoDays);
    if (i < 100) return undefined;
    return {
      info: `min ${i} files`,
      solutions: {
        all: {
          solve: async () => {
            const bytes = await deleteCacheFiles(cacheDir, twoDays);
            return (bytes / 1000).toFixed(1) + " kb cleaned";
          },
        },
        "temp files": {
          solve: async () => {
            const bytes = await deleteCacheFiles(cacheDir + "tmp/", twoDays);
            return (bytes / 1000).toFixed(1) + " kb cleaned";
          },
        },
      },
    };
  };

  // ── clean logs, clients and sessions ────────────────────────────────────
  types.cleanup["clean logs, clients and sessions"] = () => ({
    info: "deletes not used and older then one month, can take long!",
    solutions: {
      run: {
        solve: async () => {
          const start = Date.now();
          const monthAgo = Math.floor((Date.now() / 1000) - 60 * 60 * 24 * 30);
          let msg = "";

          // logs
          const logRes = await db.query(`DELETE FROM log WHERE time < ${monthAgo} LIMIT 1000000`);
          await db.query("OPTIMIZE TABLE log");
          msg += (logRes as any).affectedRows + " log-rows deleted\n";

          // clients – simple: remove old unused
          const clientRes = await db.query(`DELETE FROM client WHERE id NOT IN (SELECT DISTINCT client_id FROM log WHERE client_id IS NOT NULL) LIMIT 1000000`);
          await db.query("OPTIMIZE TABLE client");
          msg += (clientRes as any).affectedRows + " client-rows deleted\n";

          // sessions
          const sessClearRes = await db.query("UPDATE sess SET token = NULL, data = '' WHERE access < ? AND token IS NOT NULL LIMIT 1000000", [monthAgo]);
          msg += (sessClearRes as any).affectedRows + " sess-tokens cleared\n";

          const sessRes = await db.query(`DELETE FROM sess WHERE token IS NULL AND id NOT IN (SELECT DISTINCT sess_id FROM log WHERE sess_id IS NOT NULL) LIMIT 1000000`);
          await db.query("OPTIMIZE TABLE sess");
          msg += (sessRes as any).affectedRows + " sess-rows deleted\n";

          const duration = (Date.now() - start) / 1000;
          msg += "duration: " + duration.toFixed(2) + " seconds";
          return msg;
        },
      },
    },
  });

  // ── delete not linked texts ─────────────────────────────────────────────
  types.cleanup["delete not linked texts"] = async () => {
    const count = Number(await db.one(
      "SELECT count(DISTINCT text.id) FROM text WHERE id NOT IN (SELECT DISTINCT title_id FROM page WHERE title_id IS NOT NULL)"
    ));
    if (!count) return undefined;
    return {
      info: "found " + count,
      solutions: {
        run: {
          solve: async () => {
            const res = await db.query(
              "DELETE FROM text WHERE id NOT IN (SELECT DISTINCT title_id FROM page WHERE title_id IS NOT NULL) ORDER BY id DESC LIMIT 1000000"
            );
            await db.query("OPTIMIZE TABLE text");
            return (res as any).affectedRows + " rows deleted\n";
          },
        },
      },
    };
  };

  // ── repair ──────────────────────────────────────────────────────────────
  types.repair["clean files-cache"] = () => ({
    solutions: {
      run: {
        solve: async () => {
          const bytes = await deleteCacheFiles(cacheDir, 60 * 1000);
          return (bytes / 1000).toFixed(1) + " kb cleaned";
        },
      },
    },
  });

  types.repair["clean php-data-cache"] = () => ({
    solutions: {
      run: {
        solve: async () => {
          await Deno.writeTextFile(app.appPATH + "qg/qgCacheData.txt",     "").catch(() => {});
          await Deno.writeTextFile(app.appPATH + "qg/qgCacheCounters.txt", "").catch(() => {});
        },
      },
    },
  });

  return types;
}
