// IP ranges in typed arrays: one sorted start per range and a country index, ~5 bytes (IPv4) or
// ~9 bytes (IPv6, cut to its /64 prefix) per range. A gap between ranges gets index 0: unknown.

/** Lets requests through after every few ms of work: building a table takes seconds.
 *  `if (slice.due()) await slice.pause();` */
export function slices(ms = 5): { due: () => boolean; pause: () => Promise<void> } {
  let start = performance.now();
  return {
    due: () => performance.now() - start > ms,
    pause: () => new Promise<void>((r) => setTimeout(r, 0)).then(() => void (start = performance.now())),
  };
}

/** IPv4 as an unsigned 32-bit number. */
export function ip4(ip: string): number | undefined {
  const parts = ip.split(".");
  if (parts.length !== 4) return;
  let n = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part) || Number(part) > 255) return;
    n = n * 256 + Number(part);
  }
  return n;
}

/** The /64 prefix of an IPv6 address — what a provider assigns to one line or network. */
export function ip6(ip: string): bigint | undefined {
  const [head, tail, more] = ip.replace(/%.*$/, "").split("::");
  if (more !== undefined) return;
  const h = head ? head.split(":") : [], t = tail ? tail.split(":") : [];
  const fill = 8 - h.length - t.length;
  if (tail === undefined ? fill !== 0 : fill < 1) return;
  const groups = [...h, ...Array(fill).fill("0"), ...t];
  if (!groups.every((g) => /^[\da-f]{1,4}$/i.test(g))) return;
  return BigInt("0x" + groups.slice(0, 4).map((g) => g.padStart(4, "0")).join(""));
}

type Typed = Uint32Array | BigUint64Array;

/** Collects ranges in any order, then packs them. Typed arrays from the start: 700k ranges as plain
 *  arrays of numbers and BigInts would cost the process ~100 MB while loading. */
class Builder<T extends number | bigint> {
  #Typed: new (length: number) => Typed;
  #starts: Typed;
  #ends: Typed;
  #codes = new Uint8Array(1024);
  #n = 0;
  #sorted = true;
  #max: T;
  #next: (x: T) => T;
  constructor(Typed: new (length: number) => Typed, max: T, next: (x: T) => T) {
    this.#Typed = Typed;
    this.#starts = new Typed(1024);
    this.#ends = new Typed(1024);
    this.#max = max;
    this.#next = next;
  }
  #grow<A extends Typed | Uint8Array>(a: A, New: new (length: number) => A): A {
    const b = new New(a.length * 2);
    b.set(a as never);
    return b;
  }
  add(start: T, end: T, code: number) {
    const n = this.#n;
    if (n === this.#codes.length) {
      this.#starts = this.#grow(this.#starts, this.#Typed);
      this.#ends = this.#grow(this.#ends, this.#Typed);
      this.#codes = this.#grow(this.#codes, Uint8Array);
    }
    const starts = this.#starts as unknown as T[];
    if (n && start < starts[n - 1]) this.#sorted = false;
    starts[n] = start;
    (this.#ends as unknown as T[])[n] = end;
    this.#codes[n] = code;
    this.#n++;
  }
  /** Sorted, gaps filled with 0, neighbours of the same country merged. */
  async pack(): Promise<Ranges<T>> {
    const [from, to, code, count] = [this.#starts as unknown as T[], this.#ends as unknown as T[], this.#codes, this.#n];
    // a source that lists in order (DB-IP) is not sorted again
    const order = this.#sorted
      ? undefined
      : new Uint32Array(count).map((_, i) => i).sort((a, b) => from[a] < from[b] ? -1 : from[a] > from[b] ? 1 : 0);
    // at most one gap per range: written in place, cut to size at the end
    const typed = new this.#Typed(count * 2 + 1), starts = typed as unknown as T[];
    const codes = new Uint8Array(typed.length);
    const slice = slices();
    let k = 0;
    let next: T | undefined; // first address after the ranges so far
    const push = (start: T, c: number) => {
      if (k && starts[k - 1] === start) codes[k - 1] = c; // a /64 cut collapsed two ranges
      else if (!k || codes[k - 1] !== c) starts[k] = start, codes[k++] = c;
    };
    for (let n = 0; n < count; n++) {
      if (slice.due()) await slice.pause();
      const i = order ? order[n] : n;
      if (next !== undefined && from[i] > next) push(next, 0);
      push(from[i], code[i]);
      if (next === undefined || to[i] >= next) next = this.#next(to[i]);
    }
    if (next !== undefined && next <= this.#max) push(next, 0);
    return new Ranges(typed.slice(0, k) as unknown as ArrayLike<T>, codes.slice(0, k));
  }
}

class Ranges<T extends number | bigint> {
  #starts: ArrayLike<T>;
  #codes: Uint8Array;
  constructor(starts: ArrayLike<T>, codes: Uint8Array) {
    this.#starts = starts;
    this.#codes = codes;
  }
  get length(): number {
    return this.#codes.length;
  }
  /** Country index of the last range starting at or before `ip`. */
  find(ip: T): number {
    let lo = 0, hi = this.#starts.length - 1, hit = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      if (this.#starts[mid] <= ip) hit = mid, lo = mid + 1;
      else hi = mid - 1;
    }
    return hit < 0 ? 0 : this.#codes[hit];
  }
}

/** Countries of all IPv4 and IPv6 ranges a source lists. */
export class Table {
  #v4 = new Builder(Uint32Array, 2 ** 32 - 1, (x: number) => x + 1);
  #v6 = new Builder(BigUint64Array, 2n ** 64n - 1n, (x: bigint) => x + 1n);
  #ids = new Map<string, number>();
  #codes: (string | undefined)[] = [undefined];
  #ranges?: { v4: Ranges<number>; v6: Ranges<bigint> };

  /** One range, `start`/`end` as `ip4()`/`ip6()` give them. */
  add(start: number | bigint, end: number | bigint, country: string): void {
    let id = this.#ids.get(country);
    if (id === undefined) {
      if (this.#codes.length > 255) throw new Error("locale.geoip: more than 255 countries");
      this.#ids.set(country, id = this.#codes.push(country) - 1);
    }
    if (typeof start === "number") this.#v4.add(start, end as number, id);
    else this.#v6.add(start, end as bigint, id);
  }

  /** Done adding: packs the ranges and lets the collected lists go. */
  async pack(): Promise<this> {
    this.#ranges = { v4: await this.#v4.pack(), v6: await this.#v6.pack() };
    this.#v4 = this.#v6 = undefined!;
    return this;
  }

  get size(): { v4: number; v6: number } {
    return { v4: this.#ranges?.v4.length ?? 0, v6: this.#ranges?.v6.length ?? 0 };
  }

  /** ISO 3166-1 alpha-2 code, undefined if the address is unknown or invalid. IPv4-mapped IPv6
   *  (`::ffff:1.2.3.4`) counts as IPv4. */
  country(ip: string): string | undefined {
    if (!this.#ranges) return;
    const v4 = ip.includes(".") ? ip4(ip.slice(ip.lastIndexOf(":") + 1)) : undefined;
    if (v4 !== undefined) return this.#codes[this.#ranges.v4.find(v4)];
    const v6 = ip.includes(":") && !ip.includes(".") ? ip6(ip) : undefined;
    if (v6 !== undefined) return this.#codes[this.#ranges.v6.find(v6)];
  }
}
