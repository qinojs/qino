// Address → coordinates, from Nominatim, the geocoder of the OSM project.
//
// Nominatim's policy: one cached lookup per address, no bulk, no request per page view, and an
// identifying user agent. So the caller stores the result, and only a changed address is looked up
// again — also with parallel requests or repeated wrong addresses.

const SERVICE = "https://nominatim.openstreetmap.org/search";

export type Place = { lat: number; lon: number; label: string };

/** One request per second is the documented limit; a little air on top of it. */
const GAP = 1100;
/** How long a fruitless lookup is believed before the address is tried again. */
const MISS_TTL = 3600_000;

const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

// Requests run one at a time, a second apart. The waiting request waits; no timer afterwards.
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

// Per-process caches. Hits are stored by the caller; misses are cached here, so a typo doesn't
// cause a lookup on every page view.
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
 * Coordinates of an address, or null if unknown or no answer. The caller must store the result.
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
