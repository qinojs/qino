import { sql } from "./deps.ts";
import { hee, unixTime } from "./lib/util.ts";
import { fs } from "./lib/fs.ts";
import { getCtx, requestStorage } from "./lib/ctx/Ctx.ts";
import { pwVerify } from "./lib/auth/mod.ts";
import { deleteUnlinkedDbFiles } from "./lib/DbFileManager.ts";
import { urlOf } from "./lib/App.ts";

import type { App } from "./lib/App.ts";

// Duck-typed (collected by cms.backend.system), so no type imports.
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
  const setTo = (url: string) => ({ [`set it to: ${url}`]: { solve: async () => { await app.settings.core.url(url); } } });

  warning["public address is unknown"] = async () => {
    if (await app.settings.core.url) return;
    const url = here();
    return { info: "links sent from a job cannot be built without it", solutions: url ? setTo(url) : {} };
  };

  warning["public address does not answer"] = async () => {
    const url = String(await app.settings.core.url ?? "");
    if (!url) return; // covered by the check above
    // any answer, even a redirect or 404, proves the app is reachable there
    const reason = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(5000) })
      .then((res) => res.status >= 500 ? `answers ${res.status}` : "", (e) => String(e));
    if (!reason) return;
    const current = here();
    return { info: `${hee(url)} — ${hee(reason)}`, solutions: current && current !== url ? setTo(current) : {} };
  };

  warning["public address is not the one you are on"] = async () => {
    const url = String(await settings.core.url ?? "");
    const current = here();
    const slash = (u: string) => u.replace(/\/?$/, "/");
    if (!url || !current || slash(url) === slash(current)) return;
    return { info: `mails and jobs link to ${hee(url)}`, solutions: setTo(current) };
  };

  warning["a remote module is missing public files"] = async () => {
    // only complete mirrors are stamped with their source, so a missing/other stamp = incomplete
    const partial = [];
    for (const mod of app.modules.all().values()) {
      if (mod.dir || !(mod.manifest.files ?? []).some((file: string) => file.startsWith("pub/"))) continue;
      if (await fs.text(`${mod.cache}remote/.source`).catch(() => "") !== mod.source) partial.push(mod.name);
    }
    if (!partial.length) return;
    return { info: `${hee(partial.join(", "))} — what did not arrive is fetched again on the next start` };
  };

  // ── settings ─────────────────────────────────────────────────────────────
  // qg_setting is a tree over `basis` — deleting a row alone would orphan its children
  const deleteSetting = async (id: unknown) => {
    for (const child of await db.query`SELECT id FROM qg_setting WHERE basis = ${id}`) await deleteSetting(child.id);
    await db.table("qg_setting").delete(id);
  };

  const dupRows = await db.query`SELECT ${sql.id("offset")}, basis, count(id) as count FROM qg_setting GROUP BY basis, ${sql.id("offset")} HAVING count(id) > 1`;
  for (const row of dupRows) {
    const { basis, offset } = row;
    warning[`duplicate settings "${offset}" basis:${basis}`] = async () => {
      const solutions: Record<string, { solve: () => Promise<unknown> }> = {
        "remove all without value": {
          solve: async () => {
            const empty = await db.query`SELECT id FROM qg_setting WHERE basis=${basis} AND ${sql.id("offset")} = ${offset} AND value = ''`;
            for (const r of empty) await deleteSetting(r.id);
          },
        },
      };
      const rows = await db.query`SELECT * FROM qg_setting WHERE basis=${basis} AND ${sql.id("offset")} = ${offset}`;
      for (const r of rows) {
        const countChilds = await db.one`SELECT count(*) FROM qg_setting WHERE basis=${r.id}`;
        solutions[`remove ${r.id} value:"${r.value}" childs:${countChilds}`] = {
          solve: () => deleteSetting(r.id),
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

  // ── database ─────────────────────────────────────────────────────────────
  error["corrupt tables"] = async () => {
    const corrupt = await corruptTables(db);
    const tables = Object.keys(corrupt);
    if (!tables.length) return;
    const info = Object.entries(corrupt).map(([table, msg]) => `${hee(table)}: ${hee(msg)}`).join("<br>");
    if (db.dialect !== "mysql") return { info };
    const repair = async () => {
      let out = "";
      for (const table of tables) { // one at a time: repair locks the table
        for (const row of await db.query`REPAIR TABLE ${sql.id(table)}`) out += `${row.Msg_type}: ${row.Msg_text}\n`;
      }
      return out;
    };
    return { info, solutions: { repair: { solve: repair } } };
  };

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
    const num = Number(await db.one`SELECT count(*) FROM text_lang WHERE lang = ''`);
    if (!num) return;
    return { info: `Found ${num}`, solutions: { delete: { solve: async () => { await db.exec`DELETE FROM text_lang WHERE lang = ''`; } } } };
  };

  // MySQL-only; other dialects run without it.
  const optimize = async (table: string) => { if (db.dialect === "mysql") await db.query`OPTIMIZE TABLE ${sql.id(table)}`; };

  // "no row references this table"; `except` skips columns that belong to the parent itself.
  const notLinked = (table: string, except: string[] = []) => {
    const refs = db.table(table).children.filter((f) => !except.includes(`${f.table.name}.${f.name}`));
    if (!refs.length) return sql`${false}`; // no references; an empty condition would mean "all unused"
    return sql.join(
      refs.map((f) =>
        sql`id NOT IN (SELECT DISTINCT ${sql.id(f.name)} FROM ${sql.id(f.table.name)} WHERE ${sql.id(f.name)} IS NOT NULL)`
      ),
      " AND ",
    );
  };

  cleanup["not linked texts"] = async () => {
    const where = notLinked("text", ["text_lang.text_id"]);
    const count = Number(await db.one`SELECT count(*) FROM text WHERE ${where}`);
    if (!count) return;
    return {
      info: "found " + count,
      solutions: {
        run: {
          solve: async () => {
            const res = await db.exec`DELETE FROM text WHERE ${where}`;
            await db.exec`DELETE FROM text_lang WHERE text_id NOT IN (SELECT id FROM text)`;
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
    info: "deletes what is not used any more, can take long!",
    solutions: {
      run: {
        solve: async () => {
          const start    = Date.now();
          const monthAgo = unixTime() - (60 * 60 * 24 * 30);
          let msg = "";

          const logRes = await db.exec`DELETE FROM log WHERE time < ${monthAgo} AND ${notLinked("log")}`;
          await optimize("log");
          msg += logRes.affectedRows + " log-rows deleted\n";

          for (const table of ["log_url", "log_user_agent", "log_ip"]) {
            const res = await db.exec`DELETE FROM ${sql.id(table)} WHERE ${notLinked(table)}`;
            await optimize(table);
            msg += res.affectedRows + ` ${table}-rows deleted\n`;
          }

          const clientRes = await db.exec`DELETE FROM client WHERE ${notLinked("client")}`;
          await optimize("client");
          msg += clientRes.affectedRows + " client-rows deleted\n";

          const idleBefore = unixTime() - await app.sessions.maxIdle(); // same limit as load()
          const sessClearRes = await db.exec`UPDATE sess SET token = NULL, data = '' WHERE access < ${idleBefore} AND token IS NOT NULL`;
          msg += sessClearRes.affectedRows + " sess-tokens cleared\n";

          const sessRes = await db.exec`DELETE FROM sess WHERE token IS NULL AND ${notLinked("sess")}`;
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
  const HOUR = 60 * 60 * 1000;
  const DAY  = 24 * HOUR;

  // Counts stale files, or deletes them and sums their size. Counting stops early (the checks only
  // need "many"). A file being written has a fresh mtime, so the age limit protects it.
  async function staleFiles(dir: string, maxAge: number, del = false): Promise<number> {
    let n = 0;
    try {
      for (const entry of await fs.list(dir)) {
        const full = dir + entry.name;
        if (entry.isDirectory) { n += await staleFiles(full + "/", maxAge, del); if (!del && n > 100) break; continue; }
        const stat = await fs.stat(full, { ttl: 0 }); // atime changes without writes
        if (!stat) continue;
        // atime is unreliable (relatime, noatime); FileTransformer touches mtime on hits. Use the
        // later of both; no timestamp = keep.
        const used = Math.max(stat.mtime?.getTime() ?? 0, stat.atime?.getTime() ?? 0);
        if (!used || Date.now() - used < maxAge) continue;
        if (del) n += stat.size, await fs.remove(full);
        else if (++n > 100) break;
      }
    } catch { /* dir may not exist */ }
    return n;
  }

  const kb = (bytes: number) => (bytes / 1000).toFixed(1) + " kb cleaned";

  cleanup["delete cache"] = async () => {
    if (await staleFiles(cacheDir, 2 * DAY) < 100) return;
    const older = (age: number) => ({ solve: async () => kb(await staleFiles(cacheDir, age, true)) });
    return {
      info: "100+ files",
      solutions: {
        "older than 3 months": older(90 * DAY),
        "older than 1 month":  older(30 * DAY),
        "older than 1 week":   older(7 * DAY),
        // grace period, so a request never loses a file it just wrote
        everything:            older(5 * 60_000),
        "temp files":          { solve: async () => kb(await staleFiles(app.dir + "tmp/", HOUR, true)) },
      },
    };
  };

  return { error, warning, notice, cleanup };
}

/** Corrupt tables as `table: message`, cheap enough for a health check. MySQL: tables the server
 *  cannot open lose their engine in information_schema and carry the error as comment. SQLite:
 *  `quick_check` reports per database, so the key is the database. Postgres has no cheap check. */
async function corruptTables(db: App["db"]): Promise<Record<string, string>> {
  if (db.dialect === "mysql") {
    const rows = await db.query`SELECT TABLE_NAME AS name, TABLE_COMMENT AS msg FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE' AND ENGINE IS NULL`;
    return Object.fromEntries(rows.map((row) => [String(row.name), String(row.msg)]));
  }
  if (db.dialect !== "sqlite") return {};
  const rows = await db.query`PRAGMA quick_check`.catch((e) => [{ msg: e.message }]); // badly broken files throw instead
  const errors = rows.map((row) => String(Object.values(row)[0])).filter((msg) => msg !== "ok");
  return errors.length ? { database: errors.join("\n") } : {};
}

// SQL for "now as unix epoch" per dialect.
function dbEpochSql(dialect: string): string {
  if (dialect === "postgres") return "SELECT floor(extract(epoch FROM now()))";
  if (dialect === "sqlite") return "SELECT strftime('%s','now')";
  return "SELECT UNIX_TIMESTAMP()";
}
