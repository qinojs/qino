import { sql } from "@qino/qino";

import type { Db } from "@qino/qino";

/** One running server process/connection, normalized across dialects. `id` is what `kill()` takes. */
export interface Process {
  id: string;
  key: string; // per-statement identity: pooled connections reuse `id`, so `id` alone can't track a query
  user: string;
  host: string;
  db: string;
  command: string; // MySQL Command / PG state (Query, Sleep, active, idle …)
  time: number; // seconds in the current state
  state: string; // MySQL State / PG wait_event
  info: string; // the SQL text
}

// djb2 → base36, keeps the row key short even for long statements
function hash(s: string) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

interface Adapter {
  list(db: Db): Promise<Process[]>;
  /** hard = drop the whole connection (MySQL KILL / PG terminate); else just cancel the running query. */
  kill(db: Db, id: number, hard: boolean): Promise<void>;
}

function norm(rows: Record<string, unknown>[]): Process[] {
  return rows.map((r) => {
    const id = String(r.id), command = String(r.command ?? ""), info = String(r.info ?? "");
    return {
      id,
      key: `${id}:${hash(command + "\0" + info)}`,
      user: String(r.user ?? ""),
      host: String(r.host ?? ""),
      db: String(r.db ?? ""),
      command,
      time: Number(r.time) || 0,
      state: String(r.state ?? ""),
      info,
    };
  });
}

const mysql: Adapter = {
  async list(db) {
    return norm(await db.query`
      SELECT ID id, USER user, HOST host, DB db, COMMAND command, TIME time, STATE state, INFO info
      FROM information_schema.PROCESSLIST WHERE ID <> CONNECTION_ID() ORDER BY TIME DESC`);
  },
  async kill(db, id, hard) {
    // id is integer-coerced by the caller → safe to inline; KILL takes no bound parameter
    await db.exec`${sql.raw(hard ? "KILL" : "KILL QUERY")} ${sql.raw(String(id))}`;
  },
};

const postgres: Adapter = {
  async list(db) {
    return norm(await db.query`
      SELECT pid id, usename "user", host(client_addr) host, datname db,
             state command, EXTRACT(EPOCH FROM now() - query_start)::int time,
             wait_event state, query info
      FROM pg_stat_activity
      WHERE pid <> pg_backend_pid()
      ORDER BY query_start`);
  },
  async kill(db, id, hard) {
    await db.query`SELECT ${sql.raw(hard ? "pg_terminate_backend" : "pg_cancel_backend")}(${id})`;
  },
};

// SQLite is serverless — no connection list, nothing to kill.
const sqlite: Adapter = { list: () => Promise.resolve([]), kill: () => Promise.resolve() };

const adapters: Record<string, Adapter> = { mysql, postgres, sqlite };

export const supportsProcesses = (db: Db): boolean => db.dialect !== "sqlite";
export const listProcesses = (db: Db): Promise<Process[]> => adapters[db.dialect].list(db);
export const killProcess = (db: Db, id: number, hard: boolean): Promise<void> =>
  adapters[db.dialect].kill(db, Math.trunc(id) || 0, hard);
