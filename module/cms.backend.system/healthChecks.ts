// deno-lint-ignore-file no-explicit-any

import { hee } from "../core/lib/util.ts";
import { getCtx } from "../core/lib/RequestContext.ts";
import type { HealthTypes, Solution } from "./health_check.ts";

export async function healthChecks(app: any): Promise<HealthTypes> {
  const db       = app.db;
  const ctx      = getCtx();
  const settings = app.settings;
  const domain   = new URL(ctx.req.url).hostname.replace(/^www\./, "");

  const types: HealthTypes = { error: {}, warning: {}, notice: {}, cleanup: {}, repair: {} };
  const { error, warning, notice, cleanup, repair } = types;

  // ── duplicate settings ──────────────────────────────────────────────────
  const dupRows = await db.all(
    "SELECT `offset`, basis, count(id) as count FROM qg_setting GROUP BY basis, `offset` HAVING count(id) > 1"
  );
  for (const row of dupRows) {
    const { basis, offset } = row;
    warning[`duplicate settings "${offset}" basis:${basis}`] = async () => {
      const solutions: Record<string, Solution> = {
        "remove all without value": {
          solve: async () => {
            await db.query("DELETE FROM qg_setting WHERE basis=? AND `offset` = ? AND value = ''", [basis, offset]);
          },
        },
      };
      const rows = await db.all("SELECT * FROM qg_setting WHERE basis=? AND `offset` = ?", [basis, offset]);
      for (const r of rows) {
        const countChilds = await db.one("SELECT count(*) FROM qg_setting WHERE basis=?", [r.id]);
        solutions[`remove ${r.id} value:"${r.value}" childs:${countChilds}`] = {
          solve: async () => { await db.query("DELETE FROM qg_setting WHERE id = ?", [r.id]); },
        };
      }
      return { solutions };
    };
  }

  // ── superuser default password ──────────────────────────────────────────
  const { compare } = await import("https://deno.land/x/bcrypt@v0.4.1/mod.ts");
  error["superuser default password"] = async () => {
    const usrs = await db.all("SELECT * FROM usr WHERE pw != '' ORDER BY superuser DESC, email = 'su' DESC, id LIMIT 20");
    const found: typeof usrs = [];
    let info = "";
    for (const row of usrs) {
      let match = false;
      try { match = await compare("su", row.pw); } catch { /* skip */ }
      if (!match) continue;
      found.push(row);
      info += hee(row.email) + "<br>";
    }
    if (!found.length) return undefined;
    return {
      info: info + " only the first 20 were checked",
      solutions: {
        "remove pw":   { solve: async () => { for (const r of found) await db.query("UPDATE usr SET pw='' WHERE id=?", [r.id]); } },
        "remove user": { solve: async () => { for (const r of found) await db.query("DELETE FROM usr WHERE id=?", [r.id]); } },
      },
    };
  };

  // ── mail settings ───────────────────────────────────────────────────────
  notice['default "mail from" is not in this domain'] = async () => {
    const value = String(await settings.qg?.mail?.defSender ?? "");
    if (value.endsWith("@" + domain)) return undefined;
    return { info: "its: " + hee(value), solutions: { [`set it to: info@${domain}`]: { solve: async () => { settings.qg.mail.defSender = "info@" + domain; } } } };
  };

  notice['mail "replay" not from this domain'] = async () => {
    const value = String(await settings.qg?.mail?.replay ?? "");
    if (value.endsWith("@" + domain)) return undefined;
    return { info: "its: " + hee(value), solutions: { [`set it to: info@${domain}`]: { solve: async () => { settings.qg.mail.replay = "info@" + domain; } } } };
  };

  notice["no mail recipient on debug mode"] = async () => {
    if (await settings.qg?.mail?.["on debugmode to"]) return undefined;
    const usr = ctx.user;
    if (!usr || !await usr.get("superuser")) return undefined;
    const email = String(await usr.get("email") ?? "");
    return { solutions: { [`set it to: ${hee(email)}`]: { solve: async () => { settings.qg.mail["on debugmode to"] = email; } } } };
  };

  // ── smalltext ───────────────────────────────────────────────────────────
  warning["smalltexts-counter is enabled"] = async () => {
    if (!await settings.qg?.smalltext?.counter) return undefined;
    if (!await ctx.user?.get("superuser")) return undefined;
    return { solutions: { disable: { solve: async () => { settings.qg.smalltext.counter = 0; } } } };
  };

  warning["smalltext code-logger is enabled"] = async () => {
    if (!await settings.qg?.smalltext?.code_logger) return undefined;
    if (!await ctx.user?.get("superuser")) return undefined;
    return { solutions: { disable: { solve: async () => { settings.qg.smalltext.code_logger = 0; } } } };
  };

  // ── users ────────────────────────────────────────────────────────────────
  warning["users with old password-hash"] = async () => {
    const usrs = await db.col(
      "SELECT email FROM usr WHERE active AND email != '' AND email IS NOT NULL AND pw != '' AND pw NOT LIKE '$%' LIMIT 1000"
    );
    if (!usrs.length) return undefined;
    return { info: usrs.map((e: string) => hee(e)).join("<br>"), solutions: { "todo: ": { solve: async () => "nothing" } } };
  };

  // ── debug / https ────────────────────────────────────────────────────────
  notice["debugmode is active"] = async () => {
    if (!app.debug) return undefined;
    return { info: "change it in the app config" };
  };

  warning["dev mode is active"] = async () => {
    if (!app.dev) return undefined;
    return { info: "set dev: false in the app config" };
  };

  warning["https not enforced"] = async () => {
    if (app.https) return undefined;
    return { info: "set https: true in the app config" };
  };

  // ── db-time vs os-time ───────────────────────────────────────────────────
  notice["db-time unlike os-time"] = async () => {
    const dbTime = Number(await db.one("SELECT UNIX_TIMESTAMP() as time"));
    const osTime = Math.floor(Date.now() / 1000);
    if (dbTime === osTime) return undefined;
    return { info: `db: ${new Date(dbTime * 1000).toISOString()}<br>os: ${new Date(osTime * 1000).toISOString()}` };
  };

  // ── texts with no lang ───────────────────────────────────────────────────
  notice["texts with no lang"] = async () => {
    const num = Number(await db.one("SELECT count(*) FROM text WHERE lang = ''"));
    if (!num) return undefined;
    return { info: `Found ${num}`, solutions: { delete: { solve: async () => { await db.query("DELETE FROM text WHERE lang = ''"); } } } };
  };

  // ── orphaned settings ────────────────────────────────────────────────────
  const installedModules = app.modules.all();
  const skipModules = new Set(["app1", "client1", "m", "qg"]);
  for (const module of Object.keys(settings as Record<string, unknown>)) {
    if (skipModules.has(module) || installedModules[module]) continue;
    notice[`settings needed :${module}`] = () => ({
      info: "did you deinstall the module?",
      solutions: { delete: { solve: async () => { delete (settings as Record<string, unknown>)[module]; } } },
    });
  }

  // ── cache cleanup ────────────────────────────────────────────────────────
  const cacheDir = app.appPATH + "cache/";
  const twoDays  = 60 * 60 * 24 * 2 * 1000;

  async function countCacheFiles(dir: string, maxAge: number): Promise<number> {
    let i = 0;
    try {
      for await (const entry of Deno.readDir(dir)) {
        if (entry.name.startsWith(".")) continue;
        const full = dir + entry.name;
        i += entry.isDirectory
          ? await countCacheFiles(full + "/", maxAge)
          : (stat => (stat.atime?.getTime() ?? 0) < Date.now() - maxAge ? 1 : 0)(await Deno.stat(full));
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
        if (entry.isDirectory) { size += await deleteCacheFiles(full + "/", maxAge); continue; }
        const stat = await Deno.stat(full);
        if ((stat.atime?.getTime() ?? 0) < Date.now() - maxAge) { size += stat.size; await Deno.remove(full); }
      }
    } catch { /* skip */ }
    return size;
  }

  const kb = (bytes: number) => (bytes / 1000).toFixed(1) + " kb cleaned";

  cleanup["delete cache"] = async () => {
    if (await countCacheFiles(cacheDir, twoDays) < 100) return undefined;
    return {
      info: "100+ files",
      solutions: {
        all:          { solve: async () => kb(await deleteCacheFiles(cacheDir,           twoDays)) },
        "temp files": { solve: async () => kb(await deleteCacheFiles(cacheDir + "tmp/",  twoDays)) },
      },
    };
  };

  cleanup["clean logs, clients and sessions"] = () => ({
    info: "deletes not used and older then one month, can take long!",
    solutions: {
      run: {
        solve: async () => {
          const start    = Date.now();
          const monthAgo = Math.floor((Date.now() / 1000) - 60 * 60 * 24 * 30);
          let msg = "";

          const logRes = await db.exec("DELETE FROM log WHERE time < ? LIMIT 1000000", [monthAgo]);
          await db.query("OPTIMIZE TABLE log");
          msg += logRes.affectedRows + " log-rows deleted\n";

          const clientRes = await db.exec("DELETE FROM client WHERE id NOT IN (SELECT DISTINCT client_id FROM log WHERE client_id IS NOT NULL) LIMIT 1000000");
          await db.query("OPTIMIZE TABLE client");
          msg += clientRes.affectedRows + " client-rows deleted\n";

          const sessClearRes = await db.exec("UPDATE sess SET token = NULL, data = '' WHERE access < ? AND token IS NOT NULL LIMIT 1000000", [monthAgo]);
          msg += sessClearRes.affectedRows + " sess-tokens cleared\n";

          const sessRes = await db.exec("DELETE FROM sess WHERE token IS NULL AND id NOT IN (SELECT DISTINCT sess_id FROM log WHERE sess_id IS NOT NULL) LIMIT 1000000");
          await db.query("OPTIMIZE TABLE sess");
          msg += sessRes.affectedRows + " sess-rows deleted\n";

          msg += "duration: " + ((Date.now() - start) / 1000).toFixed(2) + " seconds";
          return msg;
        },
      },
    },
  });

  cleanup["not linked texts"] = async () => {
    const children = app.db.table("text").children;
    if (!children.length) return undefined;
    const where = children.map((f: any) => `id NOT IN (SELECT DISTINCT ${f.name} FROM ${f.table} WHERE ${f.name} IS NOT NULL)`).join(" AND ");
    const count = Number(await db.one(`SELECT count(DISTINCT id) FROM text WHERE ${where}`));
    if (!count) return undefined;
    return {
      info: "found " + count,
      solutions: {
        run: {
          solve: async () => {
            const res = await db.exec(`DELETE FROM text WHERE ${where} ORDER BY id DESC LIMIT 1000000`);
            await db.query("OPTIMIZE TABLE text");
            return res.affectedRows + " rows deleted\n";
          },
        },
      },
    };
  };

  // ── repair ───────────────────────────────────────────────────────────────
  cleanup["clean files-cache"] = async () => {
    if (await countCacheFiles(cacheDir, 60 * 1000) < 100) return undefined;
    return { solutions: { run: { solve: async () => kb(await deleteCacheFiles(cacheDir, 60 * 1000)) } } };
  };

  return types;
}
