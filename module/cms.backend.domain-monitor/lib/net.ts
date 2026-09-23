import { errMsg } from "@qino/qino";

// Shared probe helpers, separate from check.ts to avoid circular imports.

export const agent = "qino-domain-monitor";
export const ua: Record<string, string> = { "user-agent": agent };

export const timedSignal = (signal: AbortSignal | undefined, ms: number): AbortSignal =>
  signal ? AbortSignal.any([signal, AbortSignal.timeout(ms)]) : AbortSignal.timeout(ms);

// rustls puts the check time into expiry messages ("verification time 1785753422 (UNIX)", "(… seconds
// ago)"), which would report a change every hour. Remove it; the certificate's own time stays.
const stableTime = (msg: string): string =>
  msg.replace(/verification time \d+ \(UNIX\)/g, "verification time now").replace(/ \(\d+ seconds ago\)/g, "");

// fetch reports TLS problems as a bare "fetch failed" — the reason sits in the cause chain.
export function errText(e: unknown): string {
  let msg = errMsg(e);
  for (let c = (e as Error)?.cause; c instanceof Error; c = c.cause) msg += ": " + c.message;
  msg = stableTime(msg);
  return msg.length > 300 ? msg.slice(0, 300) + "…" : msg;
}

export const isCertError = (msg: string): boolean => /certificate|cert|tls|ssl|handshake/i.test(msg);
