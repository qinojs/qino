import * as nodeCrypto from "node:crypto";
import http from "node:http";
import https from "node:https";
import { BlockList, isIP } from "node:net";
import { Readable } from "node:stream";
import { extensionByType, typeByExtension } from "../deps.ts";

export interface UploadedFile {
  name: string;
  type: string;
  size: number;
  tmpPath: string;
  md5: string;
}

export async function readUploadFile(file: File, opt: { maxSize?: number } = {}): Promise<UploadedFile> {
  const tmp = await saveStream(file.stream(), opt);
  return { name: file.name, type: file.type, size: tmp.size, tmpPath: tmp.path, md5: tmp.md5 };
}

export async function fetchRemoteFile(opt: { url: string; maxSize: number }): Promise<UploadedFile> {
  const resp = await safeFetch(opt.url);
  if (!resp.ok) throw new Error(`Remote file import failed: HTTP ${resp.status}`);
  const len = parseInt(resp.headers.get("content-length") ?? "0");
  if (len && len > opt.maxSize) throw new Error("Remote file too large");
  if (!resp.body) throw new Error("Remote file has no body");
  const file = await saveStream(resp.body, { prefix: "remote-", maxSize: opt.maxSize });

  const m = resp.headers.get("content-disposition")?.match(/filename="([^"]+)"/);
  const name = (m?.[1] ?? new URL(opt.url).pathname.split("/").pop() ?? "file").replace(/\?.*/, "").split(/[\\/]/).pop() || "file";
  const type = resp.headers.get("content-type")?.replace(/;.*/, "") || typeByExtension(name.replace(/.*\./, "").toLowerCase()) || "";
  return { name, type, size: file.size, tmpPath: file.path, md5: file.md5 };
}

/** Inline bytes: `data:<mime>[;name=<file>][;base64],<data>` — reads neither network nor filesystem. */
export async function readDataUrl(uri: string, opt: { maxSize: number }): Promise<UploadedFile> {
  const m = uri.match(/^data:([^;,]*)((?:;[^;,]*)*),([\s\S]*)$/);
  if (!m) throw new Error("Invalid data URI");
  const [, type, params, payload] = m;
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = /;base64(;|$)/i.test(params)
      ? Uint8Array.from(atob(payload), (c) => c.charCodeAt(0))
      : new TextEncoder().encode(decodeURIComponent(payload));
  } catch {
    throw new Error("Invalid data URI payload");
  }
  const file = await saveStream(new Blob([bytes]).stream(), { prefix: "inline-", maxSize: opt.maxSize });
  const name = params.match(/;name=([^;]+)/)?.[1] ?? "file." + (extensionByType(type) ?? "bin");
  return { name: name.replace(/\?.*/, "").split(/[\\/]/).pop() || "file", type, size: file.size, tmpPath: file.path, md5: file.md5 };
}

async function saveStream(stream: ReadableStream<Uint8Array>, opt: { maxSize?: number; prefix?: string; dir?: string } = {}) {
  const { prefix, dir } = opt;
  const path = await Deno.makeTempFile({ prefix, dir });
  const file = await Deno.open(path, { write: true });
  const hash = nodeCrypto.createHash("md5");
  let size = 0;
  let ok = false;
  try {
    for await (const chunk of stream) {
      size += chunk.length;
      if (opt.maxSize && size > opt.maxSize) throw new Error("Stream too large");
      hash.update(chunk);
      await writeAll(file, chunk);
    }
    ok = true;
  } finally {
    file.close();
    if (!ok) await Deno.remove(path).catch(() => {});
  }
  return { path, size, md5: hash.digest("hex") };
}

async function writeAll(file: Deno.FsFile, chunk: Uint8Array): Promise<void> {
  let written = 0;
  while (written < chunk.length) written += await file.write(chunk.subarray(written));
}

const NON_PUBLIC_IPV4 = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16],
  ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) NON_PUBLIC_IPV4.addSubnet(network, prefix, "ipv4");
const NON_PUBLIC_IPV6 = new BlockList();
for (const [network, prefix] of [
  ["::", 128], ["::1", 128], ["::ffff:0:0", 96], ["64:ff9b:1::", 48], ["100::", 64], ["100:0:0:1::", 64],
  ["2001::", 23], ["2001:db8::", 32], ["2002::", 16], ["3fff::", 20], ["5f00::", 16],
  ["fc00::", 7], ["fe80::", 10], ["ff00::", 8],
] as const) NON_PUBLIC_IPV6.addSubnet(network, prefix, "ipv6");

const PUBLIC_IPV6 = new BlockList();
PUBLIC_IPV6.addSubnet("2000::", 3, "ipv6");
PUBLIC_IPV6.addSubnet("64:ff9b::", 96, "ipv6");

const PUBLIC_IPV4_EXCEPTIONS = new BlockList();
for (const ip of ["192.0.0.9", "192.0.0.10"]) PUBLIC_IPV4_EXCEPTIONS.addAddress(ip, "ipv4");
const PUBLIC_IPV6_EXCEPTIONS = new BlockList();
for (const ip of ["2001:1::1", "2001:1::2", "2001:1::3"]) PUBLIC_IPV6_EXCEPTIONS.addAddress(ip, "ipv6");
for (const [network, prefix] of [
  ["2001:3::", 32], ["2001:4:112::", 48], ["2001:20::", 28], ["2001:30::", 28],
] as const) PUBLIC_IPV6_EXCEPTIONS.addSubnet(network, prefix, "ipv6");

function isPublicIp(ip: string): boolean {
  const version = isIP(ip);
  if (!version) return false;
  if (version === 4) return PUBLIC_IPV4_EXCEPTIONS.check(ip, "ipv4") || !NON_PUBLIC_IPV4.check(ip, "ipv4");
  if (PUBLIC_IPV6_EXCEPTIONS.check(ip, "ipv6")) return true;
  return !NON_PUBLIC_IPV6.check(ip, "ipv6") && PUBLIC_IPV6.check(ip, "ipv6");
}

/** Resolves the URL once and returns only globally reachable addresses. */
async function resolvePublicIps(url: URL): Promise<string[]> {
  // URL parsing normalizes decimal/hex/octal IPv4 forms to dotted notation.
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const ips = isIP(host) ? [host] : (await Promise.all([
    Deno.resolveDns(host, "A").catch(() => []),
    Deno.resolveDns(host, "AAAA").catch(() => []),
  ])).flat();
  if (!ips.length) throw new Error(`Could not resolve: ${host}`);
  for (const ip of ips) if (!isPublicIp(ip)) throw new Error(`SSRF blocked: ${ip}`);
  return ips;
}

function pinnedFetch(url: URL, ip: string, init: RequestInit): Promise<Response> {
  const source = new Request(url, init);
  const family = isIP(ip) as 4 | 6;
  return new Promise((resolve, reject) => {
    const req = (url.protocol === "https:" ? https : http).request(url, {
      method: source.method,
      headers: Object.fromEntries(source.headers),
      signal: source.signal,
      agent: false,
      lookup: (_hostname, opt, done) => opt.all ? done(null, [{ address: ip, family }]) : done(null, ip, family),
    }, (res) => {
      const headers = new Headers();
      for (const [name, value] of Object.entries(res.headers)) {
        if (Array.isArray(value)) for (const item of value) headers.append(name, item);
        else if (value != null) headers.set(name, value);
      }
      const empty = [101, 204, 205, 304].includes(res.statusCode!);
      if (empty) res.resume();
      const response = new Response(empty ? null : Readable.toWeb(res) as ReadableStream<Uint8Array>, {
        status: res.statusCode,
        statusText: res.statusMessage,
        headers,
      });
      Object.defineProperty(response, "url", { value: url.href });
      resolve(response);
    });
    req.on("error", reject);
    if (source.body) Readable.from(source.body).on("error", reject).pipe(req);
    else req.end();
  });
}

export async function safeFetch(url: string, init?: RequestInit, maxRedirects = 5): Promise<Response> {
  const target = new URL(url);
  if (target.protocol !== "http:" && target.protocol !== "https:") throw new Error(`Unsupported URL protocol: ${target.protocol}`);
  const [ip] = await resolvePublicIps(target);
  init = { ...init, signal: init?.signal ?? AbortSignal.timeout(15000) };
  const resp = await pinnedFetch(target, ip, init);
  if ([301, 302, 303, 307, 308].includes(resp.status)) {
    const location = resp.headers.get("location");
    resp.body?.cancel().catch(() => {}); // don't leak the redirect body
    if (!location || maxRedirects <= 0) throw new Error("Too many redirects");
    return safeFetch(new URL(location, url).toString(), init, maxRedirects - 1);
  }
  return resp;
}
