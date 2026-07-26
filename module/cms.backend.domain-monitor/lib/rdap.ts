// Registry data over RDAP (RFC 9083): when the registration expires, who the registrar is and
// which EPP status codes the registry has set. A certificate expiring is visible everywhere —
// the registration expiring is the one that takes the whole domain down, so it belongs here.
//
// rdap.org redirects to whichever registry serves the TLD. Plenty of ccTLDs run no RDAP service
// at all — .ch, .de and .at are not even in the IANA bootstrap — so "no data" is a normal outcome
// and every field simply stays null. WHOIS is no fallback for them: those same registries withhold
// the expiry date there too, only the gTLD registries publish it.

import { timedSignal, ua } from "./net.ts";

const registrar = (entities: unknown): string | null => {
  for (const entity of Array.isArray(entities) ? entities : []) {
    if (!entity?.roles?.includes("registrar")) continue;
    // vcardArray is ["vcard", [["fn", {}, "text", "Name"], …]] — the display name is the "fn" entry
    for (const field of entity.vcardArray?.[1] ?? []) if (field[0] === "fn") return String(field[3] ?? "") || null;
  }
  return null;
};

const eventDate = (events: unknown, action: string): number | null => {
  const found = (Array.isArray(events) ? events : []).find((e) => e?.eventAction === action)?.eventDate;
  const ms = found ? Date.parse(found) : NaN;
  return isNaN(ms) ? null : Math.floor(ms / 1000);
};

const service = "https://rdap.org/domain/";
const blank = { expires: null, registered: null, registrar: null, status: "", locked: false };

/**
 * Registration facts, or null when the TLD has no RDAP service or it did not answer.
 * `found: false` is the opposite of no data — a registry that serves RDAP says the domain
 * is not registered, which for a monitored domain is an alarm, not a blank.
 */
export async function lookup(domain: string, signal?: AbortSignal) {
  const res = await fetch(service + encodeURIComponent(domain), {
    headers: { ...ua, accept: "application/rdap+json" },
    signal: timedSignal(signal, 10000),
  }).catch(() => null);
  if (!res?.ok) {
    await res?.body?.cancel();
    // Landing on a registry means the TLD is served and the domain really is unknown there;
    // a 404 still on rdap.org only means it could not route the TLD anywhere.
    return res?.status === 404 && !res.url.startsWith(service) ? { found: false, ...blank } : null;
  }
  const data = await res.json().catch(() => null);
  if (!data) return null;
  // Registries write the codes with spaces ("client transfer prohibited"); keep them as they come.
  const status = (Array.isArray(data.status) ? data.status : []).map(String);
  return {
    found: true,
    expires: eventDate(data.events, "expiration"),
    registered: eventDate(data.events, "registration"),
    registrar: registrar(data.entities),
    status: status.join(", "),
    locked: status.some((s: string) => /transfer prohibited/i.test(s)),
  };
}
