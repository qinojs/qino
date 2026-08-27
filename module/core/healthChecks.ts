import { sql } from "./deps.ts";
import { hee, unixTime } from "./lib/util.ts";
import { getCtx, requestStorage } from "./lib/ctx/Ctx.ts";
import { pwVerify } from "./lib/auth/mod.ts";
import { deleteUnlinkedDbFiles } from "./lib/DbFileManager.ts";
import { urlOf } from "./lib/App.ts";

import type { App } from "./lib/App.ts";

// The registry is duck-typed (cms.backend.system collects it), so nothing here imports its types.
type Check = () => unknown;

export async function healthChecks(app: App) {
  const db       = app.db;
  const settings = app.settings;

  const error:   Record<string, Check> = {};
  const warning: Record<string, Check> = {};
  const notice:  Record<string, Check> = {};
  const cleanup: Record<string, Check> = {};

  // ── public address ───────────────────────────────────────────────────────
  const here = () => {
    const ctx = requestStorage.getStore();
    return ctx ? urlOf(ctx) : "";
  };
  const setTo = (url: string) => ({ [`set it to: ${hee(url)}`]: { solve: async () => { await app.settings.core.url(url); } } });

  warning["public address is unknown"] = async () => {
    if (await app.settings.core.url) return;
    const url = here();
    return { info: "links sent from a job cannot be built without it", solutions: url ? setTo(url) : {} };
  };

  warning["public address does not answer"] = async () => {
    const url = String(await app.settings.core.url ?? "");
    if (!url) return; // the check above owns that case
    // its own address, so a redirect or a 404 still proves the app is reachable there
    const reason = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(5000) })
      .then((res) => res.status >= 500 ? `answers ${res.status}` : "", (e) => String(e));
    if (!reason) return;
    const current = here();
    return { info: `${hee(url)} — ${hee(reason)}`, solutions: current && current !== url ? setTo(current) : {} };
  };

  warning["a remote module is missing public files"] = async () => {
    // only a complete mirror is stamped with the source it came from, so a stamp that does not
    // match is the whole signal — the file that stayed away is otherwise a line in the console
    const partial = [];
    for (const mod of app.modules.all().values()) {
      if (mod.dir || !(mod.manifest.files ?? []).some((file: string) => file.startsWith("pub/"))) continue;
      if (await Deno.readTextFile(`${mod.cache}remote/.source`).catch(() => "") !== mod.source) partial.push(mod.name);
    }
    if (!partial.length) return;
    return { info: `${hee(partial.join(", "))} — what did not arrive is fetched again on the next start` };
  };

  // ── settings ─────────────────────────────────────────────────────────────
  const dupRows = await db.query`SELECT ${sql.id("offset")}, basis, count(id) as count FROM qg_setting GROUP BY basis, ${sql.id("offset")} HAVING count(id) > 1`;
  for (const row of dupRows) {
    const { basis, offset } = row;
    warning[`duplicate settings "${offset}" basis:${basis}`] = async () => {
      const solutions: Record<string, { solve: () => Promise<unknown> }> = {
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

  const installedModules = app.modules.all();
  for (const module of Object.keys(settings)) {
    if (installedModules.has(module)) continue;
    notice[`settings needed :${module}`] = () => ({
      info: "did you deinstall the module?",
      solutions: { delete: { solve: () => { delete settings[module]; } } },
    });
  }

  // ── users ────────────────────────────────────────────────────────────────
  // Only projects migrated from the PHP CMS can still have the "su"/"su" default.
  error["superuser default password"] = async () => {
    const usr = await db.row`SELECT * FROM usr WHERE username = 'su'`;
    if (!usr || !await pwVerify("su", String(usr.pw))) return;
    return {
      solutions: {
        "remove pw":   { solve: () => db.table("usr").update(usr.id, { pw: "" }) },
        "remove user": { solve: () => db.table("usr").delete(usr.id) },
      },
    };
  };

  warning["users with old password-hash"] = async () => {
    const usrs = await db.col<string>`SELECT username FROM usr WHERE active AND username != '' AND username IS NOT NULL AND pw != '' AND pw NOT LIKE '$%' LIMIT 1000`;
    if (!usrs.length) return;
    return { info: usrs.map(hee).join("<br>"), solutions: { "todo: ": { solve: () => "nothing" } } };
  };

  // ── smalltext ────────────────────────────────────────────────────────────
  warning["smalltexts-counter is enabled"] = async () => {
    if (!await settings.core.smalltext.counter) return;
    const ctx = getCtx();
    if (!ctx.user?.superuser) return;
    return { solutions: { disable: { solve: async () => { await settings.core.smalltext.counter(0); } } } };
  };

  warning["smalltext code-logger is enabled"] = async () => {
    if (!await settings.core.smalltext.code_logger) return;
    const ctx = getCtx();
    if (!ctx.user?.superuser) return;
    return { solutions: { disable: { solve: async () => { await settings.core.smalltext.code_logger(0); } } } };
  };

  // ── app config ───────────────────────────────────────────────────────────
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

  // ── texts ────────────────────────────────────────────────────────────────
  notice["texts with no lang"] = async () => {
    const num = Number(await db.one`SELECT count(*) FROM text WHERE lang = ''`);
    if (!num) return;
    return { info: `Found ${num}`, solutions: { delete: { solve: async () => { await db.exec`DELETE FROM text WHERE lang = ''`; } } } };
  };

  // MySQL-only fragments; other dialects run without cap/optimize.
  const limit1M  = db.dialect === "mysql" ? sql.raw(" LIMIT 1000000") : sql.raw("");
  const optimize = async (table: string) => { if (db.dialect === "mysql") await db.query`OPTIMIZE TABLE ${sql.id(table)}`; };
  // "no row references this table" condition, built from x-qg-parent child columns
  const notLinked = (table: string) => sql.join(db.table(table).children.map((f) => sql`id NOT IN (SELECT DISTINCT ${sql.id(f.name)} FROM ${sql.id(f.table)} WHERE ${sql.id(f.name)} IS NOT NULL)`), " AND ");

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

  // ── db files ─────────────────────────────────────────────────────────────
  cleanup["unused dbFiles"] = async () => {
    const children = db.table("file").children;
    if (!children.length) return;
    const unlinked = children.map((child) => sql`id NOT IN (SELECT ${sql.id(child.name)} FROM ${sql.id(child.table.name)})`);
    const count = Number(await db.one`SELECT count(*) FROM file WHERE ${sql.join(unlinked, " AND ")}`);
    if (!count) return;
    return {
      info: `${count} files (used()-hooks not checked yet)`,
      solutions: {
        "delete unused": { solve: async () => `${(await deleteUnlinkedDbFiles(app)).deleted} files deleted` },
      },
    };
  };

  // ── logs, clients, sessions ──────────────────────────────────────────────
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

  // ── cache ────────────────────────────────────────────────────────────────
  const cacheDir = app.dir + "cache/";
  const TWO_DAYS = 60 * 60 * 24 * 2 * 1000;

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
    if (await countCacheFiles(cacheDir, TWO_DAYS) < 100) return;
    return {
      info: "100+ files",
      solutions: {
        all:          { solve: async () => kb(await deleteCacheFiles(cacheDir,        TWO_DAYS)) },
        "temp files": { solve: async () => kb(await deleteCacheFiles(app.dir + "tmp/", TWO_DAYS)) },
      },
    };
  };

  cleanup["clean files-cache"] = async () => {
    if (await countCacheFiles(cacheDir, 60 * 1000) < 100) return;
    return { solutions: { run: { solve: async () => kb(await deleteCacheFiles(cacheDir, 60 * 1000)) } } };
  };

  return { error, warning, notice, cleanup };
}

// SQL for "now as unix epoch" per dialect.
function dbEpochSql(dialect: string): string {
  if (dialect === "postgres") return "SELECT floor(extract(epoch FROM now()))";
  if (dialect === "sqlite") return "SELECT strftime('%s','now')";
  return "SELECT UNIX_TIMESTAMP()";
}
