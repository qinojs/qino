import { sql, unixTime, type App } from "../../core/mod.ts";
import { checkDomain } from "./check.ts";

export const frequencies = ["disabled", "hourly", "daily"] as const;
export type CheckFrequency = typeof frequencies[number];

export type DomainRow = {
  domain: string;
  online?: boolean | null;
  status_code?: number | null;
  response_time?: number | null;
  final_url?: string | null;
  cert_valid?: boolean | null;
  cert_days?: number | null;
  redirect_https?: boolean | null;
  ipv6?: boolean | null;
  www_ok?: boolean | null;
  ns_answering?: number | null;
  ns_in_sync?: boolean | null;
  dns_ns?: string | null;
  dns_a?: string | null;
  dns_aaaa?: string | null;
  dns_mx?: string | null;
  dns_txt?: string | null;
  dns_caa?: string | null;
  dns_dmarc?: string | null;
  dns_changed?: number | null;
  expect?: string | null;
  check_frequency?: CheckFrequency | null;
  error?: string | null;
  checked?: number | null;
  created?: number;
  sort?: number;
  [key: string]: unknown;
};

const concurrency = 4;
const table = (app: App) => app.db.table("monitor_domain");

// A pasted entry is reduced to its host: scheme and path are dropped, everything that is not
// a plausible domain — other schemes, bare words, userinfo, bare IPs — returns "".
export const normalizeDomain = (value: string): string => {
  const input = value.trim();
  if (!input) return "";
  const scheme = input.match(/^([a-z][a-z0-9+.-]*):\/\//i)?.[1].toLowerCase();
  if (scheme && scheme !== "http" && scheme !== "https") return "";
  try {
    const url = new URL(scheme ? input : "https://" + input);
    if (url.username || url.password) return "";
    return url.hostname.length <= 191 && /^([a-z0-9](-*[a-z0-9])*\.)+([a-z]{2,}|xn--[a-z0-9-]+)$/i.test(url.hostname)
      ? url.hostname
      : ""; // labels + real TLD
  } catch { return ""; }
};

export async function runCheck(app: App, row: DomainRow, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  const check = await checkDomain(row.domain, row.expect || undefined, signal);
  signal?.throwIfAborted();
  const dns: Record<string, string> = {};
  for (const [key, list] of Object.entries(check.dns)) dns["dns_" + key] = list.join("\n");
  // remember when a record set last moved — silent DNS changes are worth noticing
  const changed = Object.entries(dns).some(([key, value]) => row[key] != null && row[key] !== value);
  const checkedAt = unixTime();
  const result = {
    ...dns,
    online: check.online,
    status_code: check.statusCode,
    response_time: check.responseTime,
    final_url: check.finalUrl,
    cert_valid: check.certValid,
    cert_days: check.certDays,
    redirect_https: check.redirectHttps,
    ipv6: check.ipv6,
    www_ok: check.wwwOk,
    ns_answering: check.nsAnswering,
    ns_in_sync: check.nsInSync,
    dns_changed: changed ? checkedAt : row.dns_changed ?? null,
    error: check.error,
    checked: checkedAt,
  };
  await app.db.transaction(async () => {
    // Update hooks add metadata such as log_id_ch; keep it out of the measured result.
    await table(app).update(row.domain, { ...result });
    await app.db.table("monitor_domain_check").insert({
      domain: row.domain,
      checked_at: checkedAt,
      result: JSON.stringify(result),
    });
  });
}

export async function runChecks(app: App, rows: DomainRow[], signal?: AbortSignal): Promise<void> {
  let index = 0;
  const worker = async () => {
    while (index < rows.length) {
      signal?.throwIfAborted();
      const row = rows[index++];
      await runCheck(app, row, signal);
    }
  };
  const results = await Promise.allSettled(Array.from({ length: Math.min(concurrency, rows.length) }, worker));
  const failed = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
  if (failed) throw failed.reason;
}

// The pasted list arrives as `vars` from cms.reloadNode (background apt POST, no full reload).
// Returns the entries that were no usable domain, so the form can name them.
export async function addDomains(app: App, list: string): Promise<string[]> {
  const added: DomainRow[] = [];
  const skipped: string[] = [];
  for (const raw of new Set(list.split(/[\s,]+/).filter(Boolean))) {
    const domain = normalizeDomain(raw);
    if (!domain) { skipped.push(raw); continue; }
    if (await app.db.one`SELECT domain FROM monitor_domain WHERE domain = ${domain}`) continue; // skip duplicates
    await table(app).insert({ domain, check_frequency: "disabled", created: unixTime() });
    added.push({ domain, check_frequency: "disabled" });
  }
  await runChecks(app, added);
  return skipped;
}

// Which rows a check covers: everything, everything with a problem, or an explicit domain list.
// "all" and "problem" can never collide with a domain — a domain always has a dot.
export async function rowsFor(app: App, scope: string): Promise<DomainRow[]> {
  const db = app.db;
  if (scope === "all") return await db.query<DomainRow>`SELECT * FROM monitor_domain`;
  if (scope === "problem") {
    return await db.query<DomainRow>`SELECT * FROM monitor_domain
      WHERE checked IS NULL OR error IS NOT NULL OR online = ${false} OR status_code >= 400
        OR cert_valid = ${false} OR cert_days < 14 OR redirect_https = ${false}
        OR ipv6 = ${false} OR www_ok = ${false} OR ns_in_sync = ${false}`;
  }
  const list = scope.split(",").filter(Boolean);
  if (!list.length) return [];
  return await db.query<DomainRow>`SELECT * FROM monitor_domain WHERE domain IN (${sql.join(list.map((domain) => sql`${domain}`), ",")})`;
}

export async function setFrequency(app: App, domain: string, frequency: string): Promise<void> {
  if (!frequencies.includes(frequency as CheckFrequency)) throw new TypeError(`Invalid check frequency: ${frequency}`);
  await table(app).update(domain, { check_frequency: frequency });
}

export async function runScheduled(app: App, frequency: Exclude<CheckFrequency, "disabled">, signal: AbortSignal): Promise<void> {
  const rows = await app.db.query<DomainRow>`SELECT * FROM monitor_domain WHERE check_frequency = ${frequency} ORDER BY sort, domain`;
  await runChecks(app, rows, signal);
}

export async function pruneHistory(app: App): Promise<void> {
  const keepDays = Math.max(1, Number(await app.settings["cms.backend.domain-monitor"].historyDays) || 90);
  await app.db.exec`DELETE FROM monitor_domain_check WHERE checked_at < ${unixTime() - keepDays * 86400}`;
}

export function parseResult(value: unknown): Partial<DomainRow> | undefined {
  try {
    const result = JSON.parse(String(value));
    return result && typeof result === "object" && "status_code" in result && "checked" in result
      ? result as Partial<DomainRow>
      : undefined;
  } catch { return; }
}
