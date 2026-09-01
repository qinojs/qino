// Address → coordinates, from Nominatim, the geocoder of the OSM project.
//
// Nominatim's usage policy allows exactly one shape of use: a single, cached lookup per
// address — no bulk runs, no request per page view, and an agent that says who is asking.
// So this module answers once and the caller stores the answer; it is asked again only
// when the address itself changes. Everything here exists to keep that promise even when
// several requests arrive at the same second, or the same wrong address is retried forever.

const SERVICE = "https://nominatim.openstreetmap.org/search";

export type Place = { lat: number; lon: number; label: string };

/** One request per second is the documented limit; a little air on top of it. */
const GAP = 1100;
/** How long a fruitless lookup is believed before the address is tried again. */
const MISS_TTL = 3600_000;

const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

// Requests are chained, never parallel: whatever the site does, openstreetmap.org sees one
// lookup at a time, a second apart. The gap is waited out by the request that needs it, not
// held open afterwards — an idle site keeps no timer running for a map nobody asked about.
let queue = Promise.resolve();
let last = 0;
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    const wait = last + GAP - Date.now();
    if (wait > 0) await sleep(wait);
    last = Date.now();
    return await fn();
  });
  queue = run.then(() => {}, () => {});
  return run;
}

// Two caches, both per process. The hit is stored by the caller and never comes back
// here; the miss has nowhere else to live, and without it a typo would ask Nominatim
// again on every single page view.
const inFlight = new Map<string, Promise<Place | null>>();
const misses = new Map<string, number>();

async function ask(address: string, agent: string, lang?: string): Promise<Place | null> {
  const url = `${SERVICE}?q=${encodeURIComponent(address)}&format=jsonv2&limit=1`;
  const res = await fetch(url, {
    headers: { "user-agent": agent, accept: "application/json", ...(lang ? { "accept-language": lang } : {}) },
    signal: AbortSignal.timeout(8000),
  }).catch(() => null);

  if (!res?.ok) {
    await res?.body?.cancel();
    return null;
  }

  const list = await res.json().catch(() => null);
  const hit = Array.isArray(list) ? list[0] : null;
  const lat = Number(hit?.lat);
  const lon = Number(hit?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon, label: String(hit.display_name ?? "") };
}

/**
 * The place an address names, or null when Nominatim does not know it or did not answer.
 * The caller is expected to persist a result — this is not a cache to read from.
 */
export function geocode(address: string, agent: string, lang?: string): Promise<Place | null> {
  const q = address.trim().replace(/\s+/g, " ");
  if (!q) return Promise.resolve(null);

  const key = `${q}\n${lang ?? ""}`;
  const missedAt = misses.get(key);
  if (missedAt !== undefined) {
    if (Date.now() - missedAt < MISS_TTL) return Promise.resolve(null);
    misses.delete(key);
  }

  // Same address, several requests in the same moment: one lookup, one answer for all.
  const running = inFlight.get(key);
  if (running) return running;

  const task = serial(() => ask(q, agent, lang))
    .then((place) => {
      if (!place) misses.set(key, Date.now());
      return place;
    })
    .finally(() => inFlight.delete(key));

  inFlight.set(key, task);
  return task;
}
