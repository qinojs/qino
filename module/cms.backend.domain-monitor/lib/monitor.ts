import { sql, unixTime, type App } from "../../core/mod.ts";
import { checkDomain } from "./check.ts";
import { diffResults, lastResult } from "./changes.ts";

export const FREQUENCIES = ["disabled", "hourly", "daily", "weekly"] as const;
export type CheckFrequency = typeof FREQUENCIES[number];

export type DomainRow = {
  domain: string;
  online?: boolean | null;
  status_code?: number | null;
  response_time?: number | null;
  final_url?: string | null;
  cert_valid?: boolean | null;
  cert_days?: number | null;
  cert_issuer?: string | null;
  cert_names?: string | null;
  cert_names_ok?: boolean | null;
  redirect_https?: boolean | null;
  hsts?: number | null;
  hsts_flags?: string | null;
  headers_missing?: string | null;
  alt_svc?: string | null;
  soft_404?: boolean | null;
  ipv6?: boolean | null;
  www_ok?: boolean | null;
  ns_servers?: string | null;
  soa_primary?: string | null;
  soa_serial?: number | null;
  soa_expire?: number | null;
  soa_minimum?: number | null;
  dnssec?: boolean | null;
  dns_ns?: string | null;
  dns_ns_parent?: string | null;
  dns_a?: string | null;
  dns_aaaa?: string | null;
  dns_mx?: string | null;
  dns_txt?: string | null;
  dns_caa?: string | null;
  dns_dmarc?: string | null;
  dns_cname?: string | null;
  dns_ds?: string | null;
  dns_https?: string | null;
  dns_ttl?: string | null;
  reg_found?: boolean | null;
  reg_expires?: number | null;
  reg_created?: number | null;
  reg_registrar?: string | null;
  reg_status?: string | null;
  reg_locked?: boolean | null;
  mail_hosts?: string | null;
  mail_hosts_ok?: boolean | null;
  mail_null_mx?: boolean | null;
  mail_starttls?: boolean | null;
  mail_tls_valid?: boolean | null;
  mail_banner?: string | null;
  mail_dane?: string | null;
  spf?: string | null;
  spf_policy?: string | null;
  spf_lookups?: number | null;
  spf_error?: string | null;
  dmarc_policy?: string | null;
  dmarc_sub?: string | null;
  dmarc_pct?: number | null;
  dmarc_rua?: boolean | null;
  dkim?: string | null;
  mta_sts?: string | null;
  mta_sts_mode?: string | null;
  tls_rpt?: string | null;
  bimi?: string | null;
  expect?: string | null;
  check_frequency?: CheckFrequency | null;
  error?: string | null;
  changed?: number | null;
  changes?: string | null;
  checked?: number | null;
  checked_deep?: number | null;
  created?: number;
  sort?: number;
  [key: string]: unknown;
};

const CONCURRENCY = 4;
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

const DEEP_AFTER = 24 * 60 * 60;

export async function runCheck(app: App, row: DomainRow, opt: { reach?: { silent: number }; signal?: AbortSignal } = {}): Promise<void> {
  const signal = opt.signal;
  signal?.throwIfAborted();
  // Registry data, the MTA-STS policy file and guessing DKIM selectors are wasted effort on an
  // hourly schedule — those move in days. Everything else is checked every time.
  const deep = !row.checked_deep || unixTime() - row.checked_deep > DEEP_AFTER;
  const check = await checkDomain(row.domain, {
    expect: row.expect || undefined,
    deep,
    dkim: (row.dkim ?? "").split("\n").filter(Boolean),
    reach: opt.reach,
    signal,
  });
  signal?.throwIfAborted();
  const dns: Record<string, string> = { dns_cname: check.dnsCname, dns_ds: check.dnsDs, dns_https: check.dnsHttps, dns_ns_parent: check.dnsNsParent };
  for (const [key, list] of Object.entries(check.dns)) dns["dns_" + key] = list.join("\n");
  const checkedAt = unixTime();
  const mail = check.mail;
  // A run that skipped the registry lookup must not wipe what an earlier one found.
  const registry = check.registry === undefined ? {} : {
    reg_found: check.registry?.found ?? null,
    reg_expires: check.registry?.expires ?? null,
    reg_created: check.registry?.registered ?? null,
    reg_registrar: check.registry?.registrar ?? "",
    reg_status: check.registry?.status ?? "",
    reg_locked: check.registry?.locked ?? null,
  };
  const result = {
    ...dns,
    ...registry,
    online: check.online,
    status_code: check.statusCode,
    response_time: check.responseTime,
    final_url: check.finalUrl,
    cert_valid: check.certValid,
    cert_days: check.certDays,
    cert_issuer: check.certIssuer,
    cert_names: check.certNames,
    cert_names_ok: check.certNamesOk,
    redirect_https: check.redirectHttps,
    hsts: check.hsts,
    hsts_flags: check.hstsFlags,
    headers_missing: check.headersMissing,
    alt_svc: check.altSvc,
    soft_404: check.soft404,
    ipv6: check.ipv6,
    www_ok: check.wwwOk,
    ns_servers: check.nsServers,
    soa_primary: check.soaPrimary,
    soa_serial: check.soaSerial,
    soa_expire: check.soaExpire,
    soa_minimum: check.soaMinimum,
    dnssec: check.dnssec,
    dns_ttl: check.dnsTtl,
    mail_hosts: mail?.hosts.join("\n") ?? "",
    mail_hosts_ok: mail?.hostsOk ?? null,
    mail_null_mx: mail?.nullMx ?? null,
    mail_starttls: mail?.starttls ?? null,
    mail_tls_valid: mail?.tlsValid ?? null,
    mail_banner: mail?.banner ?? "",
    mail_dane: mail?.dane ?? "",
    spf: mail?.spf ?? "",
    spf_policy: mail?.spfPolicy ?? "",
    spf_lookups: mail?.spfLookups ?? null,
    spf_error: mail?.spfError ?? "",
    dmarc_policy: mail?.dmarcPolicy ?? "",
    dmarc_sub: mail?.dmarcSub ?? "",
    dmarc_pct: mail?.dmarcPct ?? null,
    dmarc_rua: mail?.dmarcRua ?? null,
    dkim: mail?.dkim ?? "",
    mta_sts: mail?.mtaSts ?? "",
    tls_rpt: mail?.tlsRpt ?? "",
    bimi: mail?.bimi ?? "",
    // Only a deep run fetches the policy file, a shallow one would report it as gone.
    ...(deep ? { mta_sts_mode: mail?.mtaStsMode ?? "", checked_deep: checkedAt } : {}),
    error: check.error,
    checked: checkedAt,
  };
  // What moved since the last stored measurement — silent changes are the ones worth noticing.
  // Comparing against the stored result rather than against the row keeps both sides in the same
  // shape; the row comes back from the driver with 1/0 where the result has booleans.
  const changes = diffResults(await lastResult(app, row.domain), result);
  await app.db.transaction(async () => {
    // Update hooks add metadata such as log_id_ch; keep it out of the measured result.
    await table(app).update(row.domain, {
      ...result,
      ...(changes.length ? { changed: checkedAt, changes: changes.map((change) => change.key).join("\n") } : {}),
    });
    await app.db.table("monitor_domain_check").insert({
      domain: row.domain,
      checked_at: checkedAt,
      result: JSON.stringify(result),
    });
  });
}

export async function runChecks(app: App, rows: DomainRow[], signal?: AbortSignal): Promise<void> {
  let index = 0;
  // Shared for the whole run: once two mail servers stay silent, this host clearly blocks
  // outgoing port 25 and every further attempt would only buy another timeout.
  const reach = { silent: 0 };
  const worker = async () => {
    while (index < rows.length) {
      signal?.throwIfAborted();
      const row = rows[index++];
      await runCheck(app, row, { reach, signal });
    }
  };
  const results = await Promise.allSettled(Array.from({ length: Math.min(CONCURRENCY, rows.length) }, worker));
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

export async function rowsFor(app: App, domains: string[]): Promise<DomainRow[]> {
  if (!domains.length) return [];
  return await app.db.query<DomainRow>`SELECT * FROM monitor_domain WHERE domain IN (${sql.join(domains.map((domain) => sql`${domain}`), ",")})`;
}

export async function setFrequency(app: App, domains: string[], frequency: string): Promise<void> {
  if (!FREQUENCIES.includes(frequency as CheckFrequency)) throw new TypeError(`Invalid check frequency: ${frequency}`);
  for (const domain of domains) await table(app).update(domain, { check_frequency: frequency });
}

export async function runScheduled(app: App, frequency: Exclude<CheckFrequency, "disabled">, signal: AbortSignal): Promise<void> {
  const rows = await app.db.query<DomainRow>`SELECT * FROM monitor_domain WHERE check_frequency = ${frequency} ORDER BY sort, domain`;
  await runChecks(app, rows, signal);
}

export function parseResult(value: unknown): Partial<DomainRow> | undefined {
  try {
    const result = JSON.parse(String(value));
    return result && typeof result === "object" && "status_code" in result && "checked" in result
      ? result as Partial<DomainRow>
      : undefined;
  } catch { return; }
}
