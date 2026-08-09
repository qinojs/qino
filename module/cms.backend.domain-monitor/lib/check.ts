// Health probe for a single domain: HTTP reachability, TLS validity and expiry, http→https
// redirect, IPv6 reachability, DNS records, mail policy and nameserver agreement.
// Always probes https://<domain>/ — the scheme is not part of what a domain is.
// Pure and dependency-free, except for an optional `openssl` call for the certificate details.

import { resolve, serverIps, systemServer, type Type } from "./dns.ts";
import * as mail from "./mail.ts";
import * as rdap from "./rdap.ts";
import { agent, errText, isCertError, timedSignal, ua } from "./net.ts";

export type Dns = { ns: string[]; a: string[]; aaaa: string[]; mx: string[]; txt: string[]; caa: string[]; dmarc: string[] };

export type CheckResult = {
  online: boolean; // the server answered at all — 401/404 are answers, not downtime
  statusCode: number | null;
  responseTime: number | null; // ms
  finalUrl: string | null; // only when redirects landed somewhere else
  certValid: boolean | null; // null when the connection never got that far
  certDays: number | null; // days until the certificate expires
  certIssuer: string;
  certNames: string; // subjectAltName entries, one per line
  certNamesOk: boolean | null; // ... and the probed host is among them
  redirectHttps: boolean | null;
  hsts: number | null; // max-age in seconds, 0 when the header is absent
  hstsFlags: string;
  headersMissing: string; // security headers the answer did not carry
  altSvc: string;
  soft404: boolean | null; // a made-up path answers like a made-up path should
  ipv6: boolean | null; // null when there is no AAAA or no IPv6 route here
  wwwOk: boolean | null; // www ↔ apex counterpart, null when it has no address
  nsServers: string; // what each authoritative nameserver answered, one per line — see nsAgreement
  dnsNsParent: string; // the delegation as the parent hands it out, one name per line
  soaSerial: number | null;
  soaExpire: number | null;
  soaMinimum: number | null; // negative-answer caching, a mistake here outlives the fix
  soaPrimary: string;
  dns: Dns;
  dnsCname: string;
  dnsDs: string;
  dnsHttps: string;
  dnsTtl: string; // "a=300" per line, read from the authoritative servers
  dnssec: boolean | null;
  registry: Awaited<ReturnType<typeof rdap.lookup>> | undefined; // undefined = not looked up this run
  mail: Awaited<ReturnType<typeof mail.check>> | undefined;
  error: string | null;
};

// Registrable-domain heuristic: NS/MX/TXT live on the apex, A/AAAA on the exact host.
// Good enough for the common `sub.example.com` case; multi-label TLDs (co.uk) fall short.
export const apex = (host: string): string => {
  const p = host.split(".");
  return p.length <= 2 ? host : p.slice(-2).join(".");
};

/** The other half of the www ↔ apex pair. */
export const wwwAlt = (host: string): string => host.startsWith("www.") ? host.slice(4) : "www." + host;

const PORT = 443;
const bare = (name: string) => name.replace(/\.$/, ""); // Deno.resolveDns keeps the root dot, our own client does not

// `server` asks one specific nameserver instead of the system resolver.
async function dnsList(host: string, type: Deno.RecordType, server?: string): Promise<string[]> {
  try {
    const opt = server ? { nameServer: { ipAddr: server, port: 53 } } : undefined;
    const recs = await Deno.resolveDns(host, type as "A", opt);
    // Sorted throughout: resolvers rotate record sets, which would otherwise look like a change.
    if (type === "MX") {
      return (recs as unknown as Deno.MxRecord[])
        .sort((a, b) => a.preference - b.preference || a.exchange.localeCompare(b.exchange))
        .map((r) => `${r.preference} ${r.exchange}`);
    }
    if (type === "CAA") return (recs as unknown as Deno.CaaRecord[]).map((r) => `${r.tag} ${r.value}`).sort();
    if (type === "TXT") return (recs as unknown as string[][]).map((r) => r.join("")).sort();
    return (recs as string[]).sort();
  } catch {
    return [];
  }
}

async function resolveDns(host: string): Promise<Dns> {
  const root = apex(host);
  const [ns, a, aaaa, mx, txt, caa, dmarc] = await Promise.all([
    dnsList(root, "NS"),
    dnsList(host, "A"),
    dnsList(host, "AAAA"),
    dnsList(root, "MX"),
    dnsList(root, "TXT"),
    dnsList(root, "CAA"),
    dnsList("_dmarc." + root, "TXT"),
  ]);
  return { ns, a, aaaa, mx, txt, caa, dmarc };
}

// Asks every authoritative nameserver directly and writes down what it said, one line per server:
//   <name> <address> <soa serial> <soa primary> <ns set it serves, comma separated>
// A server that did not answer is its bare name. Whether the redundancy is real and the zones
// agree is read out of these lines later — this only records.
// Hands back the addresses it resolved so the later batches can reuse them.
async function nsAgreement(root: string, ns: string[]) {
  const answers = await Promise.all(ns.map(async (name) => {
    const [ip] = await dnsList(bare(name), "A");
    if (!ip) return null;
    const soa = await Deno.resolveDns(root, "SOA", { nameServer: { ipAddr: ip, port: 53 } }).catch(() => null);
    if (!soa?.length) return null;
    const zone = await dnsList(root, "NS", ip);
    return { ip, primary: soa[0].mname, serial: soa[0].serial, expire: soa[0].expire, minimum: soa[0].minimum, zone: zone.map(bare).join(",") };
  }));
  const ok = answers.filter((a) => a != null);
  return {
    servers: ns.map((name, i) => {
      const a = answers[i];
      return a ? `${bare(name)} ${a.ip} ${a.serial} ${bare(a.primary)} ${a.zone}` : bare(name);
    }).join("\n"),
    ips: ok.map((a) => a.ip),
    soa: ok[0] ?? null,
  };
}

// Everything the runtime resolver cannot answer, in as few round trips as possible: one pipelined
// batch to the zone's own servers, one to the parent for the delegation and the DS record.
async function dnsExtras(host: string, root: string, nsIps: string[], signal?: AbortSignal) {
  const blank = { ttl: "", cname: "", https: "", ds: "", dnssec: null as boolean | null, parent: "" };
  if (!nsIps.length) return blank;
  const wanted: [string, string, Type][] = [
    ["a", host, "A"],
    ["aaaa", host, "AAAA"],
    ["mx", root, "MX"],
    ["txt", root, "TXT"],
    ["ns", root, "NS"],
  ];
  const questions: { name: string; type: Type }[] = [
    ...wanted.map(([, name, type]) => ({ name, type })),
    { name: host, type: "CNAME" },
    { name: host, type: "HTTPS" },
    { name: root, type: "DNSKEY" },
  ];
  const zone = await resolve(nsIps, questions, signal);
  const [cname, https, dnskey] = zone.slice(wanted.length);

  // DS proves the delegation is signed and only ever lives at the parent, never in the zone.
  const tld = root.split(".").slice(-1)[0];
  const parent = (await Promise.all((await dnsList(tld, "NS")).slice(0, 2).map((name) => serverIps(bare(name))))).flat();
  const [ds, delegation] = parent.length
    ? await resolve(parent, [{ name: root, type: "DS" }, { name: root, type: "NS" }], signal)
    : [null, null];
  // A referral puts the NS set in the authority section, a direct answer in the answer section.
  const delegated = delegation && (delegation.values.length ? delegation.values : delegation.authority);

  return {
    // TTLs are only meaningful straight from the source: a resolver hands back what is left of a
    // cached record, which always looks shorter than what the zone actually publishes.
    ttl: wanted.map(([label], i) => zone[i]?.ttl != null ? `${label}=${zone[i]!.ttl}` : "").filter(Boolean).join("\n"),
    cname: cname?.values.join("\n") ?? "",
    https: https?.values.join("\n") ?? "",
    ds: ds?.values.join("\n") ?? "",
    // The parent has the last word on whether a zone is signed. A DS with no key behind it is
    // worse than no DS at all, so that stays unknown rather than being reported as unsigned.
    dnssec: !ds ? null : !ds.values.length ? false : dnskey ? dnskey.values.length > 0 : null,
    parent: (delegated ?? []).map(bare).sort().join("\n"),
  };
}

// Deno exposes no peer certificate, so the details come from openssl; empty when it is unavailable.
async function certInfo(host: string, signal?: AbortSignal) {
  const openssl = async (args: string[], input?: string) => {
    signal?.throwIfAborted();
    const p = new Deno.Command("openssl", { args, stdin: "piped", stdout: "piped", stderr: "null" }).spawn();
    const abort = () => { try { p.kill(); } catch { /* already exited */ } };
    signal?.addEventListener("abort", abort, { once: true });
    const kill = setTimeout(abort, 8000);
    try {
      const w = p.stdin.getWriter();
      if (input) await w.write(new TextEncoder().encode(input));
      await w.close();
      const out = await p.output();
      return new TextDecoder().decode(out.stdout);
    } finally {
      clearTimeout(kill);
      signal?.removeEventListener("abort", abort);
    }
  };
  const blank = { days: null as number | null, issuer: "", names: "" };
  try {
    const s = await openssl(["s_client", "-connect", `${host}:${PORT}`, "-servername", host]);
    const pem = s.match(/-----BEGIN CERTIFICATE-----[^]*?-----END CERTIFICATE-----/)?.[0];
    if (!pem) return blank;
    // One pass over the certificate we already fetched — expiry, who signed it, what it covers.
    const text = await openssl(["x509", "-noout", "-enddate", "-issuer", "-ext", "subjectAltName"], pem);
    const ms = Date.parse(text.match(/notAfter=(.+)/)?.[1] ?? "") - Date.now();
    const issuer = text.match(/issuer=.*?\bO\s*=\s*([^,\n]+)/)?.[1] ?? text.match(/issuer=.*?\bCN\s*=\s*([^,\n]+)/)?.[1] ?? "";
    return {
      days: isNaN(ms) ? null : Math.floor(ms / 86400000),
      issuer: issuer.trim(),
      names: [...text.matchAll(/DNS:([^\s,]+)/g)].map((m) => m[1]).sort().join("\n"),
    };
  } catch {
    return blank; // no openssl binary, or the runtime lacks --allow-run
  }
}

/** Does a certificate name cover this host — exact, or as a one-label wildcard. */
export const covers = (name: string, host: string): boolean =>
  name === host || (name.startsWith("*.") && host.endsWith(name.slice(1)) && !host.slice(0, -name.slice(1).length).includes("."));

// An AAAA record says nothing about the server, so speak real HTTP to that address.
// Unreachable networks (no IPv6 route here) stay unknown rather than marking the domain broken.
async function ipv6Answers(host: string, ip: string, signal?: AbortSignal): Promise<boolean | null> {
  let conn: Deno.Conn | undefined;
  const requestSignal = timedSignal(signal, 8000);
  const abort = () => { try { conn?.close(); } catch { /* already closed */ } };
  requestSignal.addEventListener("abort", abort, { once: true });
  try {
    conn = await Deno.connect({ hostname: ip, port: PORT, signal: requestSignal });
    conn = await Deno.startTls(conn as Deno.TcpConn, { hostname: host });
    await conn.write(new TextEncoder().encode(`HEAD / HTTP/1.1\r\nHost: ${host}\r\nUser-Agent: ${agent}\r\nConnection: close\r\n\r\n`));
    const buf = new Uint8Array(64);
    const n = await conn.read(buf);
    return /^HTTP\/1\.[01] \d{3}/.test(new TextDecoder().decode(buf.subarray(0, n ?? 0)));
  } catch (e) {
    const msg = errText(e);
    if (isCertError(msg)) return true; // the handshake reached a webserver, that is what we asked
    return /unreachable|no route|address family/i.test(msg) ? null : false;
  } finally {
    requestSignal.removeEventListener("abort", abort);
    try { conn?.close(); } catch { /* already gone */ }
  }
}

// The www ↔ apex counterpart should be served too, not merely resolve.
async function wwwCounterpart(host: string, signal?: AbortSignal): Promise<boolean | null> {
  const alt = wwwAlt(host);
  if (alt.split(".").length < 2) return null;
  const [a, aaaa] = await Promise.all([dnsList(alt, "A"), dnsList(alt, "AAAA")]);
  if (!a.length && !aaaa.length) return null; // deliberately not published
  return fetch(`https://${alt}/`, { method: "HEAD", redirect: "manual", signal: timedSignal(signal, 8000), headers: ua })
    .then((r) => { r.body?.cancel(); return r.status < 500; })
    .catch(() => false);
}

// http→https enforcement (best-effort; stays null on any hiccup).
async function redirectsToHttps(host: string, signal?: AbortSignal): Promise<boolean | null> {
  try {
    const res = await fetch(`http://${host}/`, { method: "HEAD", redirect: "manual", signal: timedSignal(signal, 8000), headers: ua });
    await res.body?.cancel();
    return res.status >= 300 && res.status < 400 && (res.headers.get("location") ?? "").startsWith("https:");
  } catch {
    return null;
  }
}

// A path nobody published must not answer 200. Sites that serve the homepage for every URL turn
// every typo and every dead link into a silent success.
function missingPage(host: string, signal?: AbortSignal): Promise<boolean | null> {
  const url = `https://${host}/qino-monitor-probe-${Math.random().toString(36).slice(2, 10)}`;
  return fetch(url, { method: "GET", redirect: "manual", signal: timedSignal(signal, 8000), headers: ua })
    .then((r) => { r.body?.cancel(); return r.status >= 400 && r.status < 500; })
    .catch(() => null);
}

// Headers a site is expected to carry. Frame protection counts either way — CSP frame-ancestors
// is the modern spelling of X-Frame-Options, requiring both would be nagging.
const WANTED_HEADERS = ["content-security-policy", "x-content-type-options", "referrer-policy", "permissions-policy"];

function headers(res: Response) {
  const has = (name: string) => !!res.headers.get(name);
  const csp = res.headers.get("content-security-policy") ?? "";
  const missing = WANTED_HEADERS.filter((name) => !has(name));
  if (!/frame-ancestors/i.test(csp) && !has("x-frame-options")) missing.push("x-frame-options");
  const sts = res.headers.get("strict-transport-security") ?? "";
  const flags = ["includeSubDomains", "preload"].filter((flag) => new RegExp(flag, "i").test(sts));
  return {
    hsts: sts ? Number(sts.match(/max-age\s*=\s*"?(\d+)/i)?.[1] ?? 0) : 0,
    hstsFlags: flags.join(", "),
    headersMissing: missing.sort().join(", "),
    altSvc: (res.headers.get("alt-svc") ?? "").slice(0, 200),
  };
}

// One request: reachability, timing, final URL, cert validity, headers and the optional content check.
type Probe = Pick<CheckResult, "online" | "statusCode" | "responseTime" | "finalUrl" | "certValid" | "error" | "hsts" | "hstsFlags" | "headersMissing" | "altSvc">;

async function probeHttp(url: string, expect?: string, signal?: AbortSignal): Promise<Probe> {
  const probe: Probe = { online: false, statusCode: null, responseTime: null, finalUrl: null, certValid: null, error: null, hsts: null, hstsFlags: "", headersMissing: "", altSvc: "" };
  try {
    const start = performance.now();
    const res = await fetch(url, { redirect: "follow", signal: timedSignal(signal, 10000), headers: ua });
    probe.responseTime = Math.round(performance.now() - start);
    probe.statusCode = res.status;
    probe.online = true; // whatever it says, something answered
    probe.certValid = true; // fetch validates the chain; a bad cert would have thrown
    Object.assign(probe, headers(res));
    if (res.url !== url) probe.finalUrl = res.url;
    if (expect && res.ok && !(await res.text()).includes(expect)) probe.error = `expected text missing: ${expect}`;
    else if (!expect || !res.ok) await res.body?.cancel();
  } catch (e) {
    probe.error = errText(e);
    probe.certValid = isCertError(probe.error) ? false : null;
  }
  return probe;
}

/**
 * `expect` is optional text that must appear in the body — a 200 alone does not prove the site works.
 * `deep` adds the checks that are wasteful to repeat hourly: registry data, the MTA-STS policy file
 * and guessing DKIM selectors. Those move on the scale of days.
 */
export async function checkDomain(domain: string, opt: {
  expect?: string;
  deep?: boolean;
  dkim?: string[];
  reach?: { silent: number };
  signal?: AbortSignal;
} = {}): Promise<CheckResult> {
  const { expect, deep = true, signal } = opt;
  signal?.throwIfAborted();
  const root = apex(domain);
  const dnsTask = resolveDns(domain); // resolves while the HTTP request is in flight
  const resolverTask = systemServer(); // for names outside the zone, DANE above all
  const probe = await probeHttp(`https://${domain}/`, expect, signal);
  const dns = await dnsTask;
  signal?.throwIfAborted();

  // Nothing here needs the nameserver addresses, so it runs while those are still being worked out.
  const httpTasks = Promise.all([
    probe.certValid ? certInfo(domain, signal) : Promise.resolve({ days: null, issuer: "", names: "" }),
    redirectsToHttps(domain, signal),
    dns.aaaa.length ? ipv6Answers(domain, dns.aaaa[0], signal) : Promise.resolve(null),
    wwwCounterpart(domain, signal),
    probe.online ? missingPage(domain, signal) : Promise.resolve(null),
  ]);
  const ns = await nsAgreement(root, dns.ns);
  signal?.throwIfAborted();

  const [[cert, redirectHttps, ipv6, wwwOk, soft404], extras, registry, mailInfo] = await Promise.all([
    httpTasks,
    dnsExtras(domain, root, ns.ips, signal),
    deep ? rdap.lookup(root, signal) : Promise.resolve(undefined),
    mail.check(root, dns.mx, { servers: ns.ips, resolver: await resolverTask, deep, dkim: opt.dkim, reach: opt.reach, signal }),
  ]);
  signal?.throwIfAborted();

  const names = cert.names.split("\n").filter(Boolean);
  return {
    ...probe,
    certDays: cert.days,
    certIssuer: cert.issuer,
    certNames: cert.names,
    certNamesOk: names.length ? names.some((name) => covers(name, domain)) : null,
    soft404,
    redirectHttps,
    ipv6,
    wwwOk,
    nsServers: ns.servers,
    dnsNsParent: extras.parent,
    soaSerial: ns.soa?.serial ?? null,
    soaExpire: ns.soa?.expire ?? null,
    soaMinimum: ns.soa?.minimum ?? null,
    soaPrimary: bare(ns.soa?.primary ?? ""),
    dns,
    dnsCname: extras.cname,
    dnsDs: extras.ds,
    dnsHttps: extras.https,
    dnsTtl: extras.ttl,
    dnssec: extras.dnssec,
    registry,
    mail: mailInfo,
  };
}
