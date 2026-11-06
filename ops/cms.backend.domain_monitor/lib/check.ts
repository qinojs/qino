// Health probe for a single domain: HTTP reachability, TLS validity and expiry, http→https
// redirect, IPv6 reachability, DNS records, mail policy and nameserver agreement.
// Always probes https://<domain>/ — the scheme is not part of what a domain is.
import { Resolver } from "node:dns/promises";

import { resolve, serverIps, systemServer } from "./dns.ts";
import * as mail from "./mail.ts";
import * as rdap from "./rdap.ts";
import { agent, connect, errText, isCertError, timedSignal, ua } from "./net.ts";

import type { Type } from "./dns.ts";

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

/** The system resolver, or with `server` that one nameserver. */
const resolver = (server?: string) => {
  const r = new Resolver();
  if (server) r.setServers([server]);
  return r;
};

async function dnsList(host: string, type: "A" | "AAAA" | "NS" | "MX" | "TXT" | "CAA", server?: string) {
  const r = resolver(server);
  try {
    // Sorted throughout: resolvers rotate record sets, which would otherwise look like a change.
    if (type === "MX") {
      return (await r.resolveMx(host))
        .sort((a, b) => a.priority - b.priority || a.exchange.localeCompare(b.exchange))
        .map((m) => `${m.priority} ${m.exchange || "."}`); // RFC 7505 null MX: "0 ."
    }
    if (type === "CAA") {
      return (await r.resolveCaa(host)).map((c) => {
        const tag = Object.keys(c).find((key) => key !== "critical")!;
        return `${tag} ${c[tag as keyof typeof c]}`;
      }).sort();
    }
    if (type === "TXT") return (await r.resolveTxt(host)).map((parts) => parts.join("")).sort();
    return (await r.resolve(host, type)).sort();
  } catch {
    return [];
  }
}

async function resolveDns(host: string) {
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

// Ask every authoritative nameserver directly; one line per server:
//   <name> <address> <soa serial> <soa primary> <ns set, comma separated>
// A silent server is just its name. Evaluation happens later. Returns the resolved addresses
// for reuse.
async function nsAgreement(root: string, ns: string[]) {
  const answers = await Promise.all(ns.map(async (name) => {
    const [ip] = await dnsList(name, "A");
    if (!ip) return null;
    const soa = await resolver(ip).resolveSoa(root).catch(() => null);
    if (!soa) return null;
    const zone = await dnsList(root, "NS", ip);
    return { ip, primary: soa.nsname, serial: soa.serial, expire: soa.expire, minimum: soa.minttl, zone: zone.join(",") };
  }));
  const ok = answers.filter((a) => a != null);
  return {
    servers: ns.map((name, i) => {
      const a = answers[i];
      return a ? `${name} ${a.ip} ${a.serial} ${a.primary} ${a.zone}` : name;
    }).join("\n"),
    ips: ok.map((a) => a.ip),
    soa: ok[0] ?? null,
  };
}

// What the runtime resolver can't answer: one batch to the zone's servers, one to the parent
// (delegation and DS).
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
  const tld = root.split(".").at(-1)!;
  const parent = (await Promise.all((await dnsList(tld, "NS")).slice(0, 2).map((name) => serverIps(name)))).flat();
  const [ds, delegation] = parent.length
    ? await resolve(parent, [{ name: root, type: "DS" }, { name: root, type: "NS" }], signal)
    : [null, null];
  // A referral puts the NS set in the authority section, a direct answer in the answer section.
  const delegated = delegation && (delegation.values.length ? delegation.values : delegation.authority);

  return {
    // TTLs only from the source: a resolver returns the remaining cache time, which is shorter.
    ttl: wanted.map(([label], i) => zone[i]?.ttl != null ? `${label}=${zone[i]!.ttl}` : "").filter(Boolean).join("\n"),
    cname: cname?.values.join("\n") ?? "",
    https: https?.values.join("\n") ?? "",
    ds: ds?.values.join("\n") ?? "",
    // The parent decides whether a zone is signed. A DS without key is worse than none, so it
    // stays unknown instead of "unsigned".
    dnssec: !ds ? null : !ds.values.length ? false : dnskey ? !!dnskey.values.length : null,
    parent: (delegated ?? []).sort().join("\n"),
  };
}

// Expiry, who signed it, what it covers — read from the handshake. Empty when that fails.
async function certInfo(host: string, signal?: AbortSignal) {
  const blank = { days: null as number | null, issuer: "", names: "" };
  const conn = await connect(host, PORT, { tls: host, signal: timedSignal(signal, 8000) }).catch(() => null);
  if (!conn) return blank;
  const cert = conn.certificate();
  conn.close();
  if (!cert?.valid_to) return blank;
  const ms = Date.parse(cert.valid_to) - Date.now();
  return {
    days: isNaN(ms) ? null : Math.floor(ms / 86400000),
    issuer: (cert.issuer?.O ?? cert.issuer?.CN ?? "").trim(),
    names: [...(cert.subjectaltname ?? "").matchAll(/DNS:([^\s,]+)/g)].map((m) => m[1]).sort().join("\n"),
  };
}

/** Does a certificate name cover this host — exact, or as a one-label wildcard. */
export const covers = (name: string, host: string): boolean =>
  name === host || (name.startsWith("*.") && host.endsWith(name.slice(1)) && !host.slice(0, -name.slice(1).length).includes("."));

// An AAAA record proves nothing, so send real HTTP to that address. No IPv6 route here = unknown,
// not broken.
async function ipv6Answers(host: string, ip: string, signal?: AbortSignal) {
  let conn: Awaited<ReturnType<typeof connect>> | undefined;
  try {
    conn = await connect(ip, PORT, { tls: host, signal: timedSignal(signal, 8000) });
    conn.write(`HEAD / HTTP/1.1\r\nHost: ${host}\r\nUser-Agent: ${agent}\r\nConnection: close\r\n\r\n`);
    return /^HTTP\/1\.[01] \d{3}/.test(new TextDecoder().decode(await conn.read() ?? undefined));
  } catch (e) {
    const msg = errText(e);
    if (isCertError(msg)) return true; // a webserver answered, that's enough
    return /unreach|no route|address family|EAFNOSUPPORT/i.test(msg) ? null : false; // ENETUNREACH, EHOSTUNREACH
  } finally {
    conn?.close();
  }
}

// The www ↔ apex counterpart should be served too, not merely resolve.
async function wwwCounterpart(host: string, signal?: AbortSignal) {
  const alt = wwwAlt(host);
  if (alt.split(".").length < 2) return null;
  const [a, aaaa] = await Promise.all([dnsList(alt, "A"), dnsList(alt, "AAAA")]);
  if (!a.length && !aaaa.length) return null; // deliberately not published
  return fetch(`https://${alt}/`, { method: "HEAD", redirect: "manual", signal: timedSignal(signal, 8000), headers: ua })
    .then((r) => { r.body?.cancel(); return r.status < 500; })
    .catch(() => false);
}

// http→https enforcement (best-effort; stays null on any hiccup).
async function redirectsToHttps(host: string, signal?: AbortSignal) {
  try {
    const res = await fetch(`http://${host}/`, { method: "HEAD", redirect: "manual", signal: timedSignal(signal, 8000), headers: ua });
    await res.body?.cancel();
    return res.status >= 300 && res.status < 400 && (res.headers.get("location") ?? "").startsWith("https:");
  } catch {
    return null;
  }
}

// A made-up path must not return 200, otherwise typos and dead links look like success.
function missingPage(host: string, signal?: AbortSignal) {
  const url = `https://${host}/qino-monitor-probe-${Math.random().toString(36).slice(2, 10)}`;
  return fetch(url, { method: "GET", redirect: "manual", signal: timedSignal(signal, 8000), headers: ua })
    .then((r) => { r.body?.cancel(); return r.status >= 400 && r.status < 500; })
    .catch(() => null);
}

// Expected security headers. Frame protection: CSP frame-ancestors or X-Frame-Options.
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

async function probeHttp(url: string, expect?: string, signal?: AbortSignal) {
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
 * `expect`: optional text the body must contain (a 200 alone proves little).
 * `deep`: also the slow-changing checks (registry data, MTA-STS policy, DKIM selector guessing).
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

  // Doesn't need the nameserver addresses, so it runs in parallel.
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
    soaPrimary: ns.soa?.primary ?? "",
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
