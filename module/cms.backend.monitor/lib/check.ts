// Health probe for a single site: HTTP reachability, TLS validity and expiry, http→https
// redirect, IPv6 reachability, DNS records, mail policy and nameserver agreement.
// Pure and dependency-free, except for an optional `openssl` call for the certificate expiry.

export type Dns = { ns: string[]; a: string[]; aaaa: string[]; mx: string[]; txt: string[]; caa: string[]; dmarc: string[] };

export type CheckResult = {
  online: boolean;
  statusCode: number | null;
  responseTime: number | null; // ms
  finalUrl: string | null; // only when redirects landed somewhere else
  certValid: boolean | null; // null when not https
  certDays: number | null; // days until the certificate expires
  redirectHttps: boolean | null;
  ipv6: boolean | null; // null when there is no AAAA or no IPv6 route here
  wwwOk: boolean | null; // www ↔ apex counterpart, null when it has no address
  nsAnswering: number | null; // authoritative nameservers that answered
  nsInSync: boolean | null; // ... and all agreed on serial + NS set
  dns: Dns;
  error: string | null;
};

// Registrable-domain heuristic: NS/MX/TXT live on the apex, A/AAAA on the exact host.
// Good enough for the common `sub.example.com` case; multi-label TLDs (co.uk) fall short.
const apex = (host: string): string => {
  const p = host.split(".");
  return p.length <= 2 ? host : p.slice(-2).join(".");
};

const agent = "qino-monitor";
const ua = { "user-agent": agent };

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

// Asks every authoritative nameserver directly: does it answer, and do they all serve the
// same zone? Catches dead redundancy and zones that drifted apart after a manual edit.
async function nsAgreement(root: string, ns: string[]): Promise<{ answering: number | null; inSync: boolean | null }> {
  if (!ns.length) return { answering: null, inSync: null };
  const answers = await Promise.all(ns.map(async (name) => {
    const [ip] = await dnsList(name, "A");
    if (!ip) return null;
    const soa = await Deno.resolveDns(root, "SOA", { nameServer: { ipAddr: ip, port: 53 } }).catch(() => null);
    if (!soa?.length) return null;
    const zone = await dnsList(root, "NS", ip);
    return { primary: soa[0].mname, serial: soa[0].serial, zone: zone.join(",") };
  }));
  const ok = answers.filter((a) => a != null);
  if (!ok.length) return { answering: 0, inSync: false };
  // The NS set must match everywhere, an empty answer counts as "did not say" rather than as drift.
  const zones = new Set(ok.map((a) => a.zone).filter(Boolean));
  // Serials only compare per primary: two providers (say Route53 + NS1) run their own numbering,
  // but every server behind one primary must have received the same zone version.
  const serialsAgree = [...Map.groupBy(ok, (a) => a.primary).values()].every((g) => new Set(g.map((a) => a.serial)).size === 1);
  return { answering: ok.length, inSync: serialsAgree && zones.size <= 1 };
}

// Deno exposes no peer certificate, so the expiry comes from openssl; null when it is unavailable.
async function certExpiryDays(host: string, port: number): Promise<number | null> {
  const openssl = async (args: string[], input?: string) => {
    const p = new Deno.Command("openssl", { args, stdin: "piped", stdout: "piped", stderr: "null" }).spawn();
    const w = p.stdin.getWriter();
    if (input) await w.write(new TextEncoder().encode(input));
    await w.close();
    const kill = setTimeout(() => { try { p.kill(); } catch { /* already exited */ } }, 8000);
    const out = await p.output().finally(() => clearTimeout(kill));
    return new TextDecoder().decode(out.stdout);
  };
  try {
    const s = await openssl(["s_client", "-connect", `${host}:${port}`, "-servername", host]);
    const pem = s.match(/-----BEGIN CERTIFICATE-----[^]*?-----END CERTIFICATE-----/)?.[0];
    const end = pem && (await openssl(["x509", "-noout", "-enddate"], pem)).match(/notAfter=(.+)/)?.[1];
    const ms = end ? Date.parse(end) - Date.now() : NaN;
    return isNaN(ms) ? null : Math.floor(ms / 86400000);
  } catch {
    return null; // no openssl binary, or the runtime lacks --allow-run
  }
}

const isCertError = (msg: string): boolean => /certificate|cert|tls|ssl|handshake/i.test(msg);

// fetch reports TLS problems as a bare "fetch failed" — the reason sits in the cause chain.
function errText(e: unknown): string {
  let msg = e instanceof Error ? e.message : String(e);
  for (let c = (e as Error)?.cause; c instanceof Error; c = c.cause) msg += ": " + c.message;
  return msg.length > 300 ? msg.slice(0, 300) + "…" : msg;
}

// An AAAA record says nothing about the server, so speak real HTTP to that address.
// Unreachable networks (no IPv6 route here) stay unknown rather than marking the site broken.
async function ipv6Answers(host: string, ip: string, port: number, https: boolean): Promise<boolean | null> {
  let conn: Deno.Conn | undefined;
  try {
    conn = await Deno.connect({ hostname: ip, port, signal: AbortSignal.timeout(8000) });
    if (https) conn = await Deno.startTls(conn as Deno.TcpConn, { hostname: host });
    await conn.write(new TextEncoder().encode(`HEAD / HTTP/1.1\r\nHost: ${host}\r\nUser-Agent: ${agent}\r\nConnection: close\r\n\r\n`));
    const buf = new Uint8Array(64);
    const n = await conn.read(buf);
    return /^HTTP\/1\.[01] \d{3}/.test(new TextDecoder().decode(buf.subarray(0, n ?? 0)));
  } catch (e) {
    const msg = errText(e);
    if (isCertError(msg)) return true; // the handshake reached a webserver, that is what we asked
    return /unreachable|no route|address family/i.test(msg) ? null : false;
  } finally {
    try { conn?.close(); } catch { /* already gone */ }
  }
}

// The www ↔ apex counterpart should be served too, not merely resolve.
async function wwwCounterpart(u: URL): Promise<boolean | null> {
  const alt = new URL(u.href);
  alt.hostname = u.hostname.startsWith("www.") ? u.hostname.slice(4) : "www." + u.hostname;
  if (alt.hostname.split(".").length < 2) return null;
  const [a, aaaa] = await Promise.all([dnsList(alt.hostname, "A"), dnsList(alt.hostname, "AAAA")]);
  if (!a.length && !aaaa.length) return null; // deliberately not published
  return await fetch(alt, { method: "HEAD", redirect: "manual", signal: AbortSignal.timeout(8000), headers: ua })
    .then((r) => { r.body?.cancel(); return r.status < 500; })
    .catch(() => false);
}

// http→https enforcement (best-effort; stays null on any hiccup).
async function redirectsToHttps(url: string): Promise<boolean | null> {
  try {
    const res = await fetch(url.replace(/^https?:/, "http:"), { method: "HEAD", redirect: "manual", signal: AbortSignal.timeout(8000), headers: ua });
    await res.body?.cancel();
    return res.status >= 300 && res.status < 400 && (res.headers.get("location") ?? "").startsWith("https:");
  } catch {
    return null;
  }
}

// One request: reachability, timing, final URL, cert validity and the optional content check.
type Probe = Pick<CheckResult, "online" | "statusCode" | "responseTime" | "finalUrl" | "certValid" | "error">;

async function probeHttp(url: string, https: boolean, expect?: string): Promise<Probe> {
  const probe: Probe = { online: false, statusCode: null, responseTime: null, finalUrl: null, certValid: null, error: null };
  try {
    const start = performance.now();
    const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(10000), headers: ua });
    probe.responseTime = Math.round(performance.now() - start);
    probe.statusCode = res.status;
    probe.online = res.ok;
    if (res.url.replace(/\/$/, "") !== url) probe.finalUrl = res.url;
    if (https) probe.certValid = true; // fetch validates the chain; a bad cert would have thrown
    if (expect && res.ok) {
      if (!(await res.text()).includes(expect)) {
        probe.online = false;
        probe.error = `expected text missing: ${expect}`;
      }
    } else await res.body?.cancel();
  } catch (e) {
    probe.error = errText(e);
    if (https) probe.certValid = isCertError(probe.error) ? false : null;
  }
  return probe;
}

// `expect` is optional text that must appear in the body — a 200 alone does not prove the site works.
export async function checkSite(url: string, expect?: string): Promise<CheckResult> {
  const u = new URL(url);
  const https = u.protocol === "https:";
  const port = Number(u.port) || (https ? 443 : 80);
  const dnsTask = resolveDns(u.hostname); // resolves while the HTTP request is in flight
  const probe = await probeHttp(url, https, expect);
  const dns = await dnsTask;

  const [certDays, redirectHttps, ipv6, wwwOk, ns] = await Promise.all([
    https && probe.certValid ? certExpiryDays(u.hostname, port) : null,
    redirectsToHttps(url),
    dns.aaaa.length ? ipv6Answers(u.hostname, dns.aaaa[0], port, https) : null,
    wwwCounterpart(u),
    nsAgreement(apex(u.hostname), dns.ns),
  ]);
  return { ...probe, certDays, redirectHttps, ipv6, wwwOk, nsAnswering: ns.answering, nsInSync: ns.inSync, dns };
}
