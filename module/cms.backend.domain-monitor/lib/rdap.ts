// Registry data via RDAP (RFC 9083): expiry, registrar, EPP status codes. An expired registration
// takes the whole domain down.
//
// rdap.org redirects to the TLD's registry. Many ccTLDs have no RDAP (.ch, .de, .at aren't even in
// the IANA bootstrap), so null fields are normal. WHOIS doesn't help: those registries hide the
// expiry there too.
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

const SERVICE = "https://rdap.org/domain/";
const BLANK = { expires: null, registered: null, registrar: null, status: "", locked: false };

/**
 * Registration data, or null if the TLD has no RDAP or it didn't answer.
 * `found: false` means the registry says the domain is not registered — an alarm.
 */
export async function lookup(domain: string, signal?: AbortSignal) {
  const res = await fetch(SERVICE + encodeURIComponent(domain), {
    headers: { ...ua, accept: "application/rdap+json" },
    signal: timedSignal(signal, 10000),
  }).catch(() => null);
  if (!res?.ok) {
    await res?.body?.cancel();
    // 404 from a registry = domain unknown; 404 from rdap.org itself = TLD not supported.
    return res?.status === 404 && !res.url.startsWith(SERVICE) ? { found: false, ...BLANK } : null;
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
