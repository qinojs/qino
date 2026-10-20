import { once } from "node:events";
import { connect as tcpConnect } from "node:net";
import { connect as tlsConnect } from "node:tls";
import { errMsg } from "@qino/qino";

import type { Socket } from "node:net";
import type { PeerCertificate, TLSSocket } from "node:tls";

// Shared probe helpers, separate from check.ts to avoid circular imports.

export const agent = "qino-domain-monitor";
export const ua: Record<string, string> = { "user-agent": agent };

export const timedSignal = (signal: AbortSignal | undefined, ms: number): AbortSignal =>
  signal ? AbortSignal.any([signal, AbortSignal.timeout(ms)]) : AbortSignal.timeout(ms);

// rustls puts the check time into expiry messages ("verification time 1785753422 (UNIX)", "(… seconds
// ago)"), which would report a change every hour. Remove it; the certificate's own time stays.
const stableTime = (msg: string) =>
  msg.replace(/verification time \d+ \(UNIX\)/g, "verification time now").replace(/ \(\d+ seconds ago\)/g, "");

// fetch reports TLS problems as a bare "fetch failed" — the reason sits in the cause chain.
export function errText(e: unknown): string {
  let msg = errMsg(e);
  for (let c = (e as Error)?.cause; c instanceof Error; c = c.cause) msg += ": " + c.message;
  msg = stableTime(msg);
  return msg.length > 300 ? msg.slice(0, 300) + "…" : msg;
}

export const isCertError = (msg: string): boolean => /certificate|cert|tls|ssl|handshake/i.test(msg);

/** A TCP connection, TLS-verified against `tls` when given. Rejects when connect or handshake fail;
 *  aborting `signal` closes it, which also ends a pending read. */
export async function connect(host: string, port: number, { tls, signal }: { tls?: string; signal: AbortSignal }) {
  const conn = new Conn(tls ? tlsConnect({ host, port, servername: tls }) : tcpConnect({ host, port }), signal);
  await conn.ready(tls ? "secureConnect" : "connect");
  return conn;
}

/** Read in pulls, like a stream reader: `read` returns what arrived, `exact` waits for a size. */
export class Conn {
  #socket!: Socket;
  // Own queue, not the socket's async iterator: Deno's STARTTLS breaks on a socket read that way.
  #chunks: Uint8Array[] = [];
  #rest: Uint8Array = new Uint8Array();
  #end: Error | true | undefined;
  #wake = () => {};
  #detach = () => {};
  #signal: AbortSignal;
  #abort = () => this.close(this.#signal.reason);

  constructor(socket: Socket, signal: AbortSignal) {
    this.#signal = signal;
    this.#use(socket);
    signal.addEventListener("abort", this.#abort, { once: true });
  }
  #use(socket: Socket) {
    const stop = (end: Error | true) => (this.#end ??= end, this.#wake());
    const data = (chunk: Uint8Array) => (this.#chunks.push(chunk), this.#wake());
    const close = () => stop(true);
    socket.on("data", data).on("close", close).on("error", stop); // errors end reads, never crash
    this.#detach = () => socket.off("data", data).off("close", close);
    this.#socket = socket;
  }
  async ready(event: string) {
    try {
      this.#signal.throwIfAborted();
      await once(this.#socket, event);
    } catch (e) {
      this.close();
      throw e;
    }
  }
  /** What arrived next, null at the end. */
  async read(): Promise<Uint8Array | null> {
    const rest = this.#rest;
    if (rest.length) return (this.#rest = new Uint8Array(), rest);
    while (!this.#chunks.length && !this.#end) await new Promise<void>((wake) => this.#wake = wake);
    if (this.#chunks.length) return this.#chunks.shift()!;
    if (this.#end === true) return null;
    throw this.#end;
  }
  /** Exactly `size` bytes, null if the connection ends first. */
  async exact(size: number): Promise<Uint8Array | null> {
    const buf = new Uint8Array(size);
    for (let at = 0; at < size;) {
      const chunk = await this.read();
      if (!chunk) return null;
      const n = Math.min(chunk.length, size - at);
      buf.set(chunk.subarray(0, n), at);
      this.#rest = chunk.subarray(n);
      at += n;
    }
    return buf;
  }
  write(data: string | Uint8Array): void {
    this.#socket.write(data);
  }
  /** The server's certificate, once TLS is up. */
  certificate(): PeerCertificate | undefined {
    return (this.#socket as TLSSocket).getPeerCertificate?.();
  }
  /** STARTTLS: go on encrypted, verified against `host`. */
  startTls(host: string): Promise<void> {
    this.#detach(); // the TLS socket reads from here on
    this.#use(tlsConnect({ socket: this.#socket, servername: host }));
    return this.ready("secureConnect");
  }
  close(reason?: unknown): void {
    this.#signal.removeEventListener("abort", this.#abort);
    this.#socket.destroy(reason as Error | undefined);
  }
}
