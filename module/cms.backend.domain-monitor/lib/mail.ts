// Mail posture of a domain: does it say who may send for it, does it say what to do with forgeries,
// and does its own mail server speak TLS. Presence of an SPF or DMARC record proves very little —
// `v=spf1 +all` and `p=none` are records that permit everything, so the values are what count.

import { resolve, type Type } from "./dns.ts";
import { agent, isCertError, errText, timedSignal, ua } from "./net.ts";

// Selectors worth guessing when a domain publishes DKIM but does not tell us where.
// There is no way to enumerate them — the name is only known to the sender and the verifier.
const dkimSelectors = ["default", "google", "selector1", "selector2", "k1", "k2", "s1", "s2", "mail", "dkim", "smtp", "zoho", "protonmail", "mandrill", "fm1"];

// Mechanisms that cost one of the ten DNS lookups an SPF record is allowed (RFC 7208 §4.6.4).
const spfCost = /^[+\-~?]?(include:|a[:/]|a$|mx[:/]|mx$|ptr|exists:|redirect=)/i;

const txtOf = (name: string): Promise<string[]> =>
  Deno.resolveDns(name, "TXT").then((r) => r.map((parts) => parts.join(""))).catch(() => []);

/**
 * DNS lookups an SPF record costs, following include: and redirect= the way a receiver would.
 * Stops once the limit is blown — the exact number past ten does not matter and the remaining
 * lookups would only cost requests.
 */
async function spfCount(record: string, seen: Set<string>): Promise<number> {
  let count = 0;
  const nested: string[] = [];
  for (const term of record.split(/\s+/)) {
    if (!spfCost.test(term)) continue;
    count++;
    const target = term.match(/^[+\-~?]?(?:include:|redirect=)(\S+)/i)?.[1];
    if (target && !seen.has(target)) { seen.add(target); nested.push(target); }
  }
  if (count > 10 || !nested.length) return count;
  const records = await Promise.all(nested.map((name) => txtOf(name).then((list) => list.find(isSpf))));
  for (const nestedRecord of records) {
    if (!nestedRecord) continue;
    count += await spfCount(nestedRecord, seen);
    if (count > 10) break;
  }
  return count;
}

const isSpf = (text: string) => /^v=spf1(\s|$)/i.test(text);

export function spf(txt: string[]) {
  const records = txt.filter(isSpf);
  // Two records are not "twice as safe" — receivers must treat it as permerror and ignore both.
  if (records.length > 1) return { record: records[0], policy: "", error: "multiple SPF records" };
  if (!records.length) return { record: "", policy: "", error: "" };
  const policy = records[0].match(/([+\-~?]all)(\s|$)/i)?.[1].toLowerCase() ?? "";
  const error = policy === "+all" ? "+all accepts every sender" : !policy ? "no all mechanism" : "";
  return { record: records[0], policy, error };
}

// "v=DMARC1; p=reject; pct=100; rua=…" — a policy of none only reports, it rejects nothing,
// and pct below 100 applies the policy to just that share of the mail.
export function dmarc(txt: string[]) {
  const record = txt.find((text) => /^v=DMARC1(\s|;|$)/i.test(text)) ?? "";
  const tag = (name: string) => record.match(new RegExp(`(?:^|;)\\s*${name}\\s*=\\s*([^;]+)`, "i"))?.[1].trim() ?? "";
  const pct = tag("pct");
  return {
    record,
    policy: tag("p").toLowerCase(),
    sub: tag("sp").toLowerCase(),
    pct: record ? (pct ? Number(pct) || 0 : 100) : null, // the default is 100 when the tag is absent
    rua: !!tag("rua"),
  };
}

/** The published policy of an MTA-STS domain: enforce, testing, none — or "" when there is none. */
async function mtaStsMode(apex: string, signal?: AbortSignal): Promise<string> {
  const res = await fetch(`https://mta-sts.${apex}/.well-known/mta-sts.txt`, { signal: timedSignal(signal, 8000), headers: ua }).catch(() => null);
  if (!res?.ok) {
    await res?.body?.cancel();
    return "";
  }
  return (await res.text().catch(() => "")).match(/^\s*mode\s*:\s*(\w+)/im)?.[1].toLowerCase() ?? "";
}

// Reads SMTP replies until the final line of one — "250 x" ends a reply, "250-x" continues it.
async function reply(conn: Deno.Conn, buf: Uint8Array): Promise<string> {
  let text = "";
  for (let i = 0; i < 16; i++) {
    const n = await conn.read(buf);
    if (n == null) break;
    text += new TextDecoder().decode(buf.subarray(0, n));
    if (/^\d{3} [^\n]*\r?\n$|\n\d{3} [^\n]*\r?\n$/.test(text)) break;
  }
  return text;
}

/**
 * Talks to the mail server the way another mail server would: banner, EHLO, STARTTLS, certificate.
 * Everything stays null when port 25 is unreachable — plenty of hosts block it outbound, and that
 * says nothing about the domain being checked.
 */
async function smtp(host: string, signal?: AbortSignal) {
  const out: { starttls: boolean | null; tlsValid: boolean | null; banner: string; silent: boolean } = { starttls: null, tlsValid: null, banner: "", silent: false };
  const limit = timedSignal(signal, 6000);
  let conn: Deno.Conn | undefined;
  const abort = () => { try { conn?.close(); } catch { /* already closed */ } };
  limit.addEventListener("abort", abort, { once: true });
  try {
    const buf = new Uint8Array(2048);
    conn = await Deno.connect({ hostname: host, port: 25, signal: limit });
    out.banner = (await reply(conn, buf)).trim().slice(0, 200);
    if (!out.banner.startsWith("2")) return out; // greeted us with a refusal, not a server we can judge
    await conn.write(new TextEncoder().encode(`EHLO ${agent}\r\n`));
    const ehlo = await reply(conn, buf);
    out.starttls = /^\d{3}[ -]STARTTLS\r?$/im.test(ehlo);
    if (!out.starttls) return out;
    await conn.write(new TextEncoder().encode("STARTTLS\r\n"));
    if (!(await reply(conn, buf)).startsWith("220")) return out;
    conn = await Deno.startTls(conn as Deno.TcpConn, { hostname: host });
    out.tlsValid = true; // startTls verifies against the system roots, a bad chain throws
    await conn.write(new TextEncoder().encode("QUIT\r\n"));
  } catch (e) {
    if (out.starttls && isCertError(errText(e))) out.tlsValid = false;
    // Nothing came back at all: either the host blocks outgoing port 25 or the server is a black
    // hole. A refusal is instant and does not land here, so this is the signal worth counting.
    out.silent = !out.banner && limit.aborted;
  } finally {
    limit.removeEventListener("abort", abort);
    abort();
  }
  return out;
}

/**
 * `mx` is the MX record set as `"<preference> <host>"`, `servers` the authoritative nameservers of
 * the zone. `deep` turns on the parts that are wasteful to repeat hourly: guessing DKIM selectors
 * and fetching the MTA-STS policy file.
 */
export async function check(apex: string, mx: string[], opt: {
  servers: string[];
  resolver: string | null;
  deep: boolean;
  dkim?: string[];
  reach?: { silent: number }; // shared across one run, see below
  signal?: AbortSignal;
}) {
  const { servers, resolver, deep, signal } = opt;
  const hosts = mx.map((record) => record.split(/\s+/)[1]?.replace(/\.$/, "") ?? "").filter(Boolean);
  // RFC 7505: a single "0 ." says this domain sends but never receives mail. Not a fault.
  const nullMx = mx.length === 1 && /^0\s+\.?$/.test(mx[0].trim());
  const primary = nullMx ? "" : hosts[0] ?? "";

  // Everything below _domainkey and the policy records lives in the zone itself, so one batch to
  // the authoritative servers covers them. Selectors are only guessed when asked for.
  const selectors = [...new Set([...(opt.dkim ?? []), ...(deep ? dkimSelectors : [])])];
  const zoneQuestions: { name: string; type: Type }[] = [
    { name: "_mta-sts." + apex, type: "TXT" },
    { name: "_smtp._tls." + apex, type: "TXT" },
    { name: "default._bimi." + apex, type: "TXT" },
    ...selectors.map((selector) => ({ name: `${selector}._domainkey.${apex}`, type: "TXT" as Type })),
  ];

  const [txt, dmarcTxt] = await Promise.all([txtOf(apex), txtOf("_dmarc." + apex)]);
  const [zone, dane, mail] = await Promise.all([
    servers.length ? resolve(servers, zoneQuestions, signal) : Promise.resolve(zoneQuestions.map(() => null)),
    // DANE lives next to the mail host, which is usually somebody else's zone — needs a resolver.
    primary && resolver ? resolve(resolver, [{ name: `_25._tcp.${primary}`, type: "TLSA" }], signal) : Promise.resolve([null]),
    // Hosts that block outgoing port 25 are common, and there every probe costs the full timeout.
    // Two silent servers in a row means it is this side, so the rest of the run skips the attempt.
    primary && (opt.reach?.silent ?? 0) < 2 ? smtp(primary, signal) : Promise.resolve({ starttls: null, tlsValid: null, banner: "", silent: false }),
  ]);
  if (opt.reach && mail.silent) opt.reach.silent++;

  const record = spf(txt);
  const policy = dmarc(dmarcTxt);
  const [mtaSts, tlsRpt, bimi, ...dkim] = zone;
  const addresses = await Promise.all(hosts.map((host) => Deno.resolveDns(host, "A").then(() => true).catch(() => false)));

  return {
    nullMx,
    hosts,
    hostsOk: hosts.length ? addresses.every(Boolean) : null, // an MX that does not resolve takes mail down
    starttls: mail.starttls,
    tlsValid: mail.tlsValid,
    banner: mail.banner,
    dane: dane[0]?.values.join("\n") ?? "",
    spf: record.record,
    spfPolicy: record.policy,
    spfLookups: record.record ? await spfCount(record.record, new Set([apex])) : null,
    spfError: record.error,
    dmarc: policy.record,
    dmarcPolicy: policy.policy,
    dmarcSub: policy.sub,
    dmarcPct: policy.pct,
    dmarcRua: policy.rua,
    // Which selectors answered, so the next run can check those without guessing the whole list.
    dkim: selectors.filter((_, i) => dkim[i]?.values.length).join("\n"),
    mtaSts: mtaSts?.values.join("") ?? "",
    mtaStsMode: deep && mtaSts?.values.length ? await mtaStsMode(apex, signal) : "",
    tlsRpt: tlsRpt?.values.join("") ?? "",
    bimi: bimi?.values.join("") ?? "",
  };
}
