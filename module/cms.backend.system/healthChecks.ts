import { hee, getCtx, sql, unixTime, pwVerify, type App } from "../core/mod.ts";
import type { HealthTypes, Solution } from "./lib/healthRegistry.ts";

export async function healthChecks(app: App): Promise<HealthTypes> {
  const db       = app.db;
  const settings = app.settings;

  const types: HealthTypes = { error: {}, warning: {}, notice: {}, cleanup: {}, repair: {} };
  const { error, warning, notice, cleanup } = types;

  // ── duplicate settings ──────────────────────────────────────────────────
  const dupRows = await db.query`SELECT ${sql.id("offset")}, basis, count(id) as count FROM qg_setting GROUP BY basis, ${sql.id("offset")} HAVING count(id) > 1`;
  for (const row of dupRows) {
    const { basis, offset } = row;
    warning[`duplicate settings "${offset}" basis:${basis}`] = async () => {
      const solutions: Record<string, Solution> = {
        "remove all without value": {
          solve: async () => {
            await db.exec`DELETE FROM qg_setting WHERE basis=${basis} AND ${sql.id("offset")} = ${offset} AND value = ''`;
          },
        },
      };
      const rows = await db.query`SELECT * FROM qg_setting WHERE basis=${basis} AND ${sql.id("offset")} = ${offset}`;
      for (const r of rows) {
        const countChilds = await db.one`SELECT count(*) FROM qg_setting WHERE basis=${r.id}`;
        solutions[`remove ${r.id} value:"${r.value}" childs:${countChilds}`] = {
          solve: async () => { await db.table("qg_setting").delete(r.id); },
        };
      }
      return { solutions };
    };
  }

  // ── superuser default password ──────────────────────────────────────────
  error["superuser default password"] = async () => {
    const usrs = await db.query`SELECT * FROM usr WHERE pw != '' ORDER BY superuser DESC, email = 'su' DESC, id LIMIT 20`;
    const found: typeof usrs = [];
    let info = "";
    for (const row of usrs) {
      if (!await pwVerify("su", row.pw)) continue;
      found.push(row);
      info += hee(row.email) + "<br>";
    }
    if (!found.length) return;
    return {
      info: info + (usrs.length === 20 ? " only the first 20 were checked" : ""),
      solutions: {
        "remove pw":   { solve: async () => { for (const r of found) await db.table("usr").update(r.id, { pw: "" }); } },
        "remove user": { solve: async () => { for (const r of found) await db.table("usr").delete(r.id); } },
      },
    };
  };

  // ── smalltext ───────────────────────────────────────────────────────────
  warning["smalltexts-counter is enabled"] = async () => {
    if (!await settings.core.smalltext.counter) return;
    const ctx = getCtx();
    if (!await ctx.user?.get("superuser")) return;
    return { solutions: { disable: { solve: async () => { await settings.core.smalltext.counter(0); } } } };
  };

  warning["smalltext code-logger is enabled"] = async () => {
    if (!await settings.core.smalltext.code_logger) return;
    const ctx = getCtx();
    if (!await ctx.user?.get("superuser")) return;
    return { solutions: { disable: { solve: async () => { await settings.core.smalltext.code_logger(0); } } } };
  };

  // ── users ────────────────────────────────────────────────────────────────
  warning["users with old password-hash"] = async () => {
    const usrs = await db.col<string>`SELECT email FROM usr WHERE active AND email != '' AND email IS NOT NULL AND pw != '' AND pw NOT LIKE '$%' LIMIT 1000`;
    if (!usrs.length) return;
    return { info: usrs.map(hee).join("<br>"), solutions: { "todo: ": { solve: () => "nothing" } } };
  };

  // ── dev / https ──────────────────────────────────────────────────────────
  warning["dev mode is active"] = () => {
    if (!app.dev) return;
    return { info: "set dev: false in the app config" };
  };

  warning["https not enforced"] = () => {
    if (app.https) return;
    return { info: "set https: true in the app config" };
  };

  // ── db-time vs os-time ───────────────────────────────────────────────────
  notice["db-time unlike os-time"] = async () => {
    const dbTime = Number(await db.one`${sql.raw(dbEpochSql(db.dialect))}`);
    const osTime = unixTime();
    if (Math.abs(dbTime - osTime) <= 2) return;
    return { info: `db: ${new Date(dbTime * 1000).toISOString()}<br>os: ${new Date(osTime * 1000).toISOString()}` };
  };

  // ── texts with no lang ───────────────────────────────────────────────────
  notice["texts with no lang"] = async () => {
    const num = Number(await db.one`SELECT count(*) FROM text WHERE lang = ''`);
    if (!num) return;
    return { info: `Found ${num}`, solutions: { delete: { solve: async () => { await db.exec`DELETE FROM text WHERE lang = ''`; } } } };
  };

  // ── orphaned settings ────────────────────────────────────────────────────
  const installedModules = app.modules.all();
  const skipModules = new Set(["app1", "client1", "m", "qg"]);
  for (const module of Object.keys(settings)) {
    if (skipModules.has(module) || installedModules[module]) continue;
    notice[`settings needed :${module}`] = () => ({
      info: "did you deinstall the module?",
      solutions: { delete: { solve: () => { delete settings[module]; } } },
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
    if (await countCacheFiles(cacheDir, twoDays) < 100) return;
    return {
      info: "100+ files",
      solutions: {
        all:          { solve: async () => kb(await deleteCacheFiles(cacheDir,           twoDays)) },
        "temp files": { solve: async () => kb(await deleteCacheFiles(cacheDir + "tmp/",  twoDays)) },
      },
    };
  };

  // MySQL-only fragments; other dialects run without cap/optimize.
  const limit1M  = db.dialect === "mysql" ? sql.raw(" LIMIT 1000000") : sql.raw("");
  const optimize = async (table: string) => { if (db.dialect === "mysql") await db.query`OPTIMIZE TABLE ${sql.id(table)}`; };
  // "no row references this table" condition, built from x-qg-parent child columns
  const notLinked = (table: string) => sql.join(db.table(table).children.map((f) => sql`id NOT IN (SELECT DISTINCT ${sql.id(f.name)} FROM ${sql.id(f.table)} WHERE ${sql.id(f.name)} IS NOT NULL)`), " AND ");

  cleanup["clean logs, clients and sessions"] = () => ({
    info: "deletes not used and older then one month, can take long!",
    solutions: {
      run: {
        solve: async () => {
          const start    = Date.now();
          const monthAgo = unixTime() - (60 * 60 * 24 * 30);
          let msg = "";

          const logRes = await db.exec`DELETE FROM log WHERE time < ${monthAgo} AND ${notLinked("log")}${limit1M}`;
          await optimize("log");
          msg += logRes.affectedRows + " log-rows deleted\n";

          for (const table of ["log_url", "log_user_agent", "log_ip"]) {
            const res = await db.exec`DELETE FROM ${sql.id(table)} WHERE ${notLinked(table)}${limit1M}`;
            await optimize(table);
            msg += res.affectedRows + ` ${table}-rows deleted\n`;
          }

          const clientRes = await db.exec`DELETE FROM client WHERE ${notLinked("client")}${limit1M}`;
          await optimize("client");
          msg += clientRes.affectedRows + " client-rows deleted\n";

          const sessClearRes = await db.exec`UPDATE sess SET token = NULL, data = '' WHERE access < ${monthAgo} AND token IS NOT NULL${limit1M}`;
          msg += sessClearRes.affectedRows + " sess-tokens cleared\n";

          const sessRes = await db.exec`DELETE FROM sess WHERE token IS NULL AND ${notLinked("sess")}${limit1M}`;
          await optimize("sess");
          msg += sessRes.affectedRows + " sess-rows deleted\n";

          msg += "duration: " + ((Date.now() - start) / 1000).toFixed(2) + " seconds";
          return msg;
        },
      },
    },
  });

  cleanup["not linked texts"] = async () => {
    if (!db.table("text").children.length) return;
    const where = notLinked("text");
    const count = Number(await db.one`SELECT count(DISTINCT id) FROM text WHERE ${where}`);
    if (!count) return;
    return {
      info: "found " + count,
      solutions: {
        run: {
          solve: async () => {
            const res = await db.exec`DELETE FROM text WHERE ${where}${limit1M}`;
            await optimize("text");
            return res.affectedRows + " rows deleted\n";
          },
        },
      },
    };
  };

  // ── repair ───────────────────────────────────────────────────────────────
  cleanup["clean files-cache"] = async () => {
    if (await countCacheFiles(cacheDir, 60 * 1000) < 100) return;
    return { solutions: { run: { solve: async () => kb(await deleteCacheFiles(cacheDir, 60 * 1000)) } } };
  };

  return types;
}

// SQL for "now as unix epoch" per dialect.
function dbEpochSql(dialect: string): string {
  if (dialect === "postgres") return "SELECT floor(extract(epoch FROM now()))";
  if (dialect === "sqlite") return "SELECT strftime('%s','now')";
  return "SELECT UNIX_TIMESTAMP()";
}
