import { b64url, safeEqual, unixTime, type App } from "../../core/mod.ts";
import { botToken } from "./bot.ts";

// A deep-link payload is `<usr>-<exp>-<sig>`, signed with the bot token: stateless on purpose —
// no table, no cleanup job. The short lifetime is what limits a link that leaks, since a valid
// one binds whoever opens it to that account. Telegram allows [A-Za-z0-9_-]{1,64} here, which
// base64url fits.

const TTL = 15 * 60;

export async function linkToken(app: App, usrId: number): Promise<string> {
  const body = `${usrId}-${unixTime() + TTL}`;
  return `${body}-${await sign(app, body)}`;
}

/** The user a `/start` payload stands for — undefined when forged or expired. */
export async function readLinkToken(app: App, payload: string): Promise<number | undefined> {
  const [usr, exp, ...rest] = payload.split("-");
  const sig = rest.join("-"); // base64url may contain "-" itself
  if (!/^\d+$/.test(usr) || !/^\d+$/.test(exp ?? "") || !sig) return;
  if (Number(exp) < unixTime()) return;
  if (!safeEqual(sig, await sign(app, `${usr}-${exp}`))) return;
  return Number(usr);
}

async function sign(app: App, data: string) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(await botToken(app)), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(data)))).slice(0, 24);
}
