// Minimal DNS client speaking the wire format over TCP.
//
// Standalone (no imports from this module), so it can move to a shared place when needed.
//
// Not Deno.resolveDns: it returns no TTLs and can't query DS or DNSKEY. TCP, not UDP: Deno's
// datagram API is unstable and TCP has no 512-byte truncation. With RFC 7766 pipelining all
// questions of a batch share one connection; answers are matched by message id. No `QTYPE=ANY`:
// RFC 8482 allows servers to answer it with a placeholder.

import { readFile } from "node:fs/promises";

export const TYPES = { A: 1, NS: 2, CNAME: 5, SOA: 6, PTR: 12, MX: 15, TXT: 16, AAAA: 28, DS: 43, DNSKEY: 48, TLSA: 52, HTTPS: 65, CAA: 257 } as const;
export type Type = keyof typeof TYPES;

const PORT = 53;
const enc = new TextEncoder();
const dec = new TextDecoder();

// RFC 5952 form, so values compare equal to what Deno.resolveDns returns.
function ipv6(bytes: Uint8Array): string {
  const groups = Array.from({ length: 8 }, (_, i) => ((bytes[i * 2] << 8) | bytes[i * 2 + 1]).toString(16));
  let at = -1, len = 0;
  for (let i = 0, run = 0; i < 8; i++) {
    run = groups[i] === "0" ? run + 1 : 0;
    if (run > len) { len = run; at = i - run + 1; } // longest run of zero groups wins
  }
  return len < 2 ? groups.join(":") : groups.slice(0, at).join(":") + "::" + groups.slice(at + len).join(":");
}

function writeName(name: string, out: number[]): void {
  for (const label of name.replace(/\.$/, "").split(".")) {
    if (!label) continue;
    const bytes = enc.encode(label);
    out.push(bytes.length, ...bytes);
  }
  out.push(0);
}

class Reader {
  #bytes: Uint8Array;
  pos = 0;
  constructor(bytes: Uint8Array) { this.#bytes = bytes; }
  u8() { return this.#bytes[this.pos++]; }
  u16() { return (this.u8() << 8) | this.u8(); }
  u32() { return this.u16() * 65536 + this.u16(); }
  take(n: number) { const from = this.pos; this.pos += n; return this.#bytes.subarray(from, this.pos); }
  // Names may be split across compression pointers; only the first jump moves the cursor on.
  name(): string {
    const parts: string[] = [];
    let pos = this.pos, jumped = false;
    for (let guard = 0; guard < 128; guard++) {
      const len = this.#bytes[pos++];
      if (!len) break; // zero length ends the name, undefined means the message was cut short
      if ((len & 0xc0) === 0xc0) {
        const target = ((len & 0x3f) << 8) | this.#bytes[pos++];
        if (!jumped) { this.pos = pos; jumped = true; }
        pos = target;
        continue;
      }
      parts.push(dec.decode(this.#bytes.subarray(pos, pos + len)));
      pos += len;
    }
    if (!jumped) this.pos = pos;
    return parts.join(".");
  }
}

// Canonical text per record type, formatted like Deno.resolveDns so both sources stay comparable.
function rdata(r: Reader, type: number, len: number): string {
  const end = r.pos + len;
  const value = (() => {
    switch (type) {
      case TYPES.A: return [...r.take(4)].join(".");
      case TYPES.AAAA: return ipv6(r.take(16));
      case TYPES.NS: case TYPES.CNAME: case TYPES.PTR: return r.name();
      case TYPES.SOA: return `${r.name()} ${r.name()} ${r.u32()} ${r.u32()} ${r.u32()} ${r.u32()} ${r.u32()}`;
      case TYPES.MX: return `${r.u16()} ${r.name()}`;
      case TYPES.TXT: { // one record can hold several strings, they belong together
        const parts: string[] = [];
        while (r.pos < end) parts.push(dec.decode(r.take(r.u8())));
        return parts.join("");
      }
      case TYPES.CAA: { r.u8(); const tag = dec.decode(r.take(r.u8())); return `${tag} ${dec.decode(r.take(end - r.pos))}`; }
      case TYPES.DS: case TYPES.DNSKEY: return `${r.u16()} ${r.u8()} ${r.u8()} ${r.take(end - r.pos).toHex()}`;
      case TYPES.TLSA: return `${r.u8()} ${r.u8()} ${r.u8()} ${r.take(end - r.pos).toHex()}`;
      case TYPES.HTTPS: return `${r.u16()} ${r.name() || "."}`; // priority and target, SvcParams skipped
      default: return r.take(end - r.pos).toHex();
    }
  })();
  r.pos = end; // whatever a branch consumed, the next record starts here
  return value;
}

function parse(msg: Uint8Array) {
  const r = new Reader(msg);
  const id = r.u16(), flags = r.u16();
  const counts = [r.u16(), r.u16(), r.u16(), r.u16()]; // question, answer, authority, additional
  let qtype = 0;
  for (let i = 0; i < counts[0]; i++) { r.name(); qtype = r.u16(); r.u16(); }
  const values: string[] = [];
  const authority: string[] = []; // the NS set of a referral, empty for a normal answer
  let ttl: number | null = null;
  for (const section of [1, 2]) {
    for (let i = 0; i < counts[section]; i++) {
      r.name();
      const type = r.u16();
      r.u16();
      const recordTtl = r.u32();
      const value = rdata(r, type, r.u16());
      if (section === 2) {
        if (type === TYPES.NS) authority.push(value);
        continue;
      }
      if (type !== qtype) continue; // a CNAME on the way to the answer is not the answer
      values.push(value);
      ttl = ttl == null ? recordTtl : Math.min(ttl, recordTtl);
    }
  }
  // Sorted because resolvers rotate record sets, which would otherwise read as a change.
  return { id, rcode: flags & 0x0f, values: values.sort(), ttl, authority: authority.sort() };
}

async function readExact(conn: Deno.Conn, size: number): Promise<Uint8Array | null> {
  const buf = new Uint8Array(size);
  for (let read = 0; read < size;) {
    const n = await conn.read(buf.subarray(read));
    if (n == null) return null;
    read += n;
  }
  return buf;
}

// Stop waiting after `ms`. The read itself rejects when the socket is closed; that rejection is
// swallowed here.
function idle<T>(pending: Promise<T>, ms: number): Promise<T | null> {
  pending.catch(() => {});
  let timer: ReturnType<typeof setTimeout> | undefined;
  const over = new Promise<null>((ok) => { timer = setTimeout(() => ok(null), ms); });
  return Promise.race([pending, over]).finally(() => clearTimeout(timer));
}

// One connection: send all open questions, collect answers in `into`. Returns whether the
// connection worked, so the caller skips dead hosts but retries partial answers.
async function exchange(
  server: string,
  open: { name: string; type: Type; at: number }[],
  into: Map<number, ReturnType<typeof parse>>,
  signal?: AbortSignal,
): Promise<boolean> {
  // The signal only covers connect; to stop reads hanging on a silent server, abort closes the socket.
  const deadline = AbortSignal.timeout(4000);
  const limit = signal ? AbortSignal.any([signal, deadline]) : deadline;
  let conn: Deno.TcpConn | undefined;
  let connected = false;
  const abort = () => { try { conn?.close(); } catch { /* already closed */ } };
  limit.addEventListener("abort", abort, { once: true });
  try {
    conn = await Deno.connect({ hostname: server, port: PORT, signal: limit });
    connected = true;
    const base = Math.floor(Math.random() * 0xf000);
    const index = new Map(open.map((question, i) => [base + i, question.at]));
    const frames: number[] = [];
    open.forEach((question, i) => {
      const id = base + i;
      const body = [id >> 8, id & 0xff, 0x01, 0x00, 0, 1, 0, 0, 0, 0, 0, 0]; // recursion desired, one question
      writeName(question.name, body);
      const type = TYPES[question.type];
      body.push(type >> 8, type & 0xff, 0, 1); // QTYPE, QCLASS=IN
      frames.push(body.length >> 8, body.length & 0xff, ...body);
    });
    const data = new Uint8Array(frames);
    for (let sent = 0; sent < data.length;) sent += await conn.write(data.subarray(sent));
    for (let received = 0; received < open.length; received++) {
      // The first answer may use the full deadline; after that, silence means the server is done
      // (even if the connection stays open).
      const head = received ? await idle(readExact(conn, 2), 1000) : await readExact(conn, 2);
      if (!head) break; // closed or gone quiet — the caller follows up on whatever is still open
      const msg = await readExact(conn, (head[0] << 8) | head[1]);
      if (!msg) break;
      const answer = parse(msg);
      const at = index.get(answer.id);
      if (at != null) into.set(at, answer);
    }
  } catch { /* unreachable, refused, blocked, or out of time */ }
  finally {
    limit.removeEventListener("abort", abort);
    abort();
  }
  return connected;
}

/**
 * Ask a batch of questions, trying the given servers in order until one answers.
 * Names come back without the trailing root dot — unlike Deno.resolveDns, normalize before comparing.
 */
export async function resolve(servers: string | string[], questions: { name: string; type: Type }[], signal?: AbortSignal) {
  const answers = new Map<number, ReturnType<typeof parse>>();
  const budget = AbortSignal.timeout(15000); // whole call, however many connections it takes
  const limit = signal ? AbortSignal.any([signal, budget]) : budget;
  const open = () => questions.flatMap((question, at) => answers.has(at) ? [] : [{ ...question, at }]);
  // Three servers is plenty of redundancy; walking a ten-address NS set would only buy timeouts.
  for (const server of [servers].flat().slice(0, 3)) {
    signal?.throwIfAborted();
    // Many servers (e.g. Cloudflare) answer only the first question and close. The rest go out
    // on separate connections in parallel — two round trips cover both kinds of server.
    if (!await exchange(server, open(), answers, limit)) continue;
    for (let pass = 0; pass < 2 && open().length && !limit.aborted; pass++) {
      const before = answers.size;
      await Promise.all(open().slice(0, 12).map((question) => exchange(server, [question], answers, limit)));
      if (answers.size === before) break; // this server is not going to answer the rest
    }
    if (answers.size === questions.length) break;
  }
  return questions.map((_, at) => answers.get(at) ?? null);
}

/** First nameserver of the host, for questions that need a recursive resolver. */
export const systemServer = (): Promise<string | null> =>
  readFile("/etc/resolv.conf", "utf8")
    .then((text) => text.match(/^\s*nameserver\s+(\S+)/m)?.[1] ?? null)
    .catch(() => null);

/** Addresses of a nameserver name, so callers can ask that server directly. */
export const serverIps = (name: string): Promise<string[]> =>
  Deno.resolveDns(name, "A").catch(() => []) as Promise<string[]>;
