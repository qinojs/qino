import { safeEqual, sha256hex } from "@qino/qino";

import type { App } from "@qino/qino";

const ID = /^[\w-]{16,64}$/;
/** Error groups taken from one report; the client sends at most this many. */
const MAX = 500;

const str = (v: unknown, max = 65535) => String(v ?? "").slice(0, max);
const int = (v: unknown) => Number.isInteger(Number(v)) ? Number(v) : null;
const now = () => new Date().toISOString().slice(0, 19).replace("T", " ");
const time = (v: unknown) => /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(String(v)) ? String(v) : now();

/** The same error on every instance. */
export const fingerprint = (e: Record<string, unknown>): Promise<string> =>
  sha256hex([e.source, e.file, e.line, e.col].map((v) => String(v ?? "")).join("\n"));

/** Takes a report of the `reporting` module. An unknown id registers with its key, if `open`; a known one
 *  must bring the same key. Returns an error message, or undefined when stored. */
export async function intake(app: App, auth: string, body: unknown, ip: string, open: boolean): Promise<string | undefined> {
  const [id = "", key = ""] = auth.replace(/^Bearer\s+/i, "").split(".");
  if (!ID.test(id) || key.length < 32) return "invalid credentials";
  if (typeof body !== "object" || !body || Array.isArray(body)) return "invalid report";
  const report = body as Record<string, unknown>;

  const known = await app.db.row`SELECT key_hash FROM reporting_instance WHERE id = ${id}`;
  const hash = await sha256hex(key);
  if (known ? !safeEqual(hash, String(known.key_hash)) : !open) return "unknown instance";

  const meta = {
    id,
    url: str(report.url, 255),
    qino: str(report.qino, 32),
    commit: str(report.commit, 64),
    runtime: str(report.runtime, 64),
    modules: (Array.isArray(report.modules) ? report.modules : []).map((m) => str(m, 100)).join(","),
    ip: str(ip, 39),
    last_seen: now(),
  };
  if (known) await app.db.table("reporting_instance").update(meta);
  else await app.db.table("reporting_instance").insert({ ...meta, key_hash: hash, first_seen: meta.last_seen });

  const errors = Array.isArray(report.errors) ? report.errors.slice(0, MAX) : [];
  await app.db.transaction(async () => {
    for (const e of errors as Record<string, unknown>[]) {
      if (typeof e !== "object" || !e) continue;
      const row = {
        source: str(e.source, 10),
        file: str(e.file),
        line: int(e.line),
        col: int(e.col),
        prio: str(e.prio, 10),
        message: str(e.message),
        last_seen: time(e.last_seen),
      };
      const fp = await fingerprint(row), hits = Math.max(1, int(e.hits) ?? 1);
      const done = await app.db.exec`UPDATE reporting_error SET hits = hits + ${hits}, last_seen = ${row.last_seen},
        message = ${row.message}, prio = ${row.prio} WHERE instance = ${id} AND fp = ${fp}`;
      if (!done.affectedRows) await app.db.table("reporting_error").insert({ ...row, instance: id, fp, hits, first_seen: time(e.first_seen) });
    }
  });
}
