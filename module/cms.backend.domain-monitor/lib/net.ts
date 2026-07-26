// The handful of things every probe here needs. Separate from check.ts so the mail and registry
// probes can use them without importing the orchestrator back.

export const agent = "qino-domain-monitor";
export const ua: Record<string, string> = { "user-agent": agent };

export const timedSignal = (signal: AbortSignal | undefined, ms: number): AbortSignal =>
  signal ? AbortSignal.any([signal, AbortSignal.timeout(ms)]) : AbortSignal.timeout(ms);

// fetch reports TLS problems as a bare "fetch failed" — the reason sits in the cause chain.
export function errText(e: unknown): string {
  let msg = e instanceof Error ? e.message : String(e);
  for (let c = (e as Error)?.cause; c instanceof Error; c = c.cause) msg += ": " + c.message;
  return msg.length > 300 ? msg.slice(0, 300) + "…" : msg;
}

export const isCertError = (msg: string): boolean => /certificate|cert|tls|ssl|handshake/i.test(msg);
