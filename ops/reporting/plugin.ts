import { fileURLToPath, pathToFileURL } from "node:url";
import { sys, uid, unixTime } from "@qino/qino";

import type { App } from "@qino/qino";
import type { Jobs } from "@qino/qino/cron";

export const settingsSchema = {
  properties: {
    url: {
      type: "string",
      description: "Address of the app running cms.backend.reporting_server. Empty: nothing is sent.",
    },
    id: { type: "string", description: "This instance at the server; set by the first report." },
    key: { type: "string", description: "Proves the id to the server; set by the first report." },
    sent: { type: "integer", description: "The last error report sent." },
    sentAt: { type: "integer", description: "When the last report was sent." },
  },
};

/** Without new errors, one report an hour says the instance is alive. */
const HEARTBEAT = 60 * 60;
/** Error groups per report, the most frequent first; rarer ones show again when they recur. */
const MAX = 500;

const qinoUrl = new URL("../../", import.meta.resolve("@qino/qino")).href;

/** A file the same on every instance: within qino or the app, else the path of a URL (its origin differs). */
export function relative(file: string, roots: [string, string][]): string {
  for (const [root, name] of roots) if (file.startsWith(root)) return name + file.slice(root.length);
  return URL.parse(file)?.pathname ?? file;
}

/** What the instance runs, and its errors since report `since` up to `last`, grouped like error_report does. */
export async function report(app: App, since: number, last: number) {
  const roots: [string, string][] = [[qinoUrl, "qino/"], [pathToFileURL(app.dir).href.replace(/\/?$/, "/"), "app/"]];
  const errors = await app.db.query`
    SELECT source, file, line, col, MAX(prio) AS prio, MAX(message) AS message,
      COUNT(*) AS hits, MIN(time) AS first_seen, MAX(time) AS last_seen
    FROM m_error_report
    WHERE id > ${since} AND id <= ${last} AND source NOT IN ('404', 'suspicious')
    GROUP BY source, file, line, col
    ORDER BY hits DESC
    LIMIT ${MAX}`;
  const deno = await import(qinoUrl + "deno.json", { with: { type: "json" } }).catch(() => ({ default: {} }));
  const git = qinoUrl.startsWith("file:")
    ? await sys.command("git", { args: ["rev-parse", "HEAD"], cwd: fileURLToPath(qinoUrl), stdout: "piped", stderr: "null" }).catch(() => null)
    : null;
  return {
    url: await app.url().catch(() => ""),
    qino: String(deno.default.version ?? ""),
    commit: git?.success ? new TextDecoder().decode(git.stdout).trim() : "",
    runtime: sys.runtime,
    modules: app.modules.linked().map((m) => m.name).sort(),
    errors: errors.map((e) => Object.assign(e, { file: relative(String(e.file ?? ""), roots) })),
  };
}

/** New errors go out within the interval; without any, a heartbeat. */
export async function send(app: App, { signal }: { signal: AbortSignal }): Promise<void> {
  const set = app.settings.reporting;
  const url = String(await set.url ?? "");
  if (!url) return;
  const last = Number(await app.db.one`SELECT MAX(id) FROM m_error_report` ?? 0);
  let since = Number(await set.sent ?? 0);
  if (last < since) since = 0; // the table was emptied and its ids start over
  if (last <= since && unixTime() - Number(await set.sentAt ?? 0) < HEARTBEAT) return;

  let id = String(await set.id ?? ""), key = String(await set.key ?? "");
  if (!id || !key) {
    [id, key] = [uid(), uid() + uid()];
    await set.id(id);
    await set.key(key);
  }
  const res = await fetch(new URL("reporting", url.replace(/\/?$/, "/")), {
    method: "POST",
    headers: { authorization: `Bearer ${id}.${key}`, "content-type": "application/json" },
    body: JSON.stringify(await report(app, since, last)),
    signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]),
  });
  if (!res.ok) throw new Error(`reporting server answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
  await set.sent(last);
  await set.sentAt(unixTime());
}

export const cron = {
  send: { every: 10 * 60, timeout: 60, run: send },
} satisfies Jobs;
