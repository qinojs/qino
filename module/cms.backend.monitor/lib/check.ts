// Health probe for a single site: HTTP reachability, TLS validity,
// http→https redirect, and DNS records. Pure and dependency-free.

export type Dns = { ns: string[]; a: string[]; aaaa: string[]; mx: string[]; txt: string[] };

export type CheckResult = {
  online: boolean;
  statusCode: number | null;
  responseTime: number | null; // ms
  certValid: boolean | null; // null when not https
  redirectHttps: boolean | null;
  dns: Dns;
  error: string | null;
};

// Registrable-domain heuristic: NS/MX/TXT live on the apex, A/AAAA on the exact host.
// Good enough for the common `sub.example.com` case; multi-label TLDs (co.uk) fall short.
const apex = (host: string): string => {
  const p = host.split(".");
  return p.length <= 2 ? host : p.slice(-2).join(".");
};

async function dnsList(host: string, type: Deno.RecordType): Promise<string[]> {
  try {
    const recs = await Deno.resolveDns(host, type as "A");
    if (type === "MX") return (recs as unknown as Deno.MxRecord[]).map((r) => `${r.preference} ${r.exchange}`);
    if (type === "TXT") return (recs as unknown as string[][]).map((r) => r.join(""));
    return recs as string[];
  } catch {
    return [];
  }
}

async function resolveDns(host: string): Promise<Dns> {
  const root = apex(host);
  const [ns, a, aaaa, mx, txt] = await Promise.all([
    dnsList(root, "NS"),
    dnsList(host, "A"),
    dnsList(host, "AAAA"),
    dnsList(root, "MX"),
    dnsList(root, "TXT"),
  ]);
  return { ns, a, aaaa, mx, txt };
}

const isCertError = (msg: string): boolean => /certificate|cert|tls|ssl|handshake/i.test(msg);

export async function checkSite(url: string): Promise<CheckResult> {
  const u = new URL(url);
  const https = u.protocol === "https:";
  const result: CheckResult = {
    online: false,
    statusCode: null,
    responseTime: null,
    certValid: null,
    redirectHttps: null,
    dns: await resolveDns(u.hostname),
    error: null,
  };

  try {
    const start = performance.now();
    const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(10000), headers: { "user-agent": "qino-monitor" } });
    result.responseTime = Math.round(performance.now() - start);
    result.statusCode = res.status;
    result.online = res.ok;
    if (https) result.certValid = true; // fetch validates the chain; a bad cert would have thrown
    await res.body?.cancel();
  } catch (e) {
    result.error = e instanceof Error ? e.message : String(e);
    if (https) result.certValid = isCertError(result.error) ? false : null;
  }

  // http→https enforcement (best-effort; stays null on any hiccup)
  try {
    const res = await fetch(url.replace(/^https?:/, "http:"), { method: "HEAD", redirect: "manual", signal: AbortSignal.timeout(8000) });
    result.redirectHttps = res.status >= 300 && res.status < 400 && (res.headers.get("location") ?? "").startsWith("https:");
    await res.body?.cancel();
  } catch { /* best-effort */ }

  return result;
}
