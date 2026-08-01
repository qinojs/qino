import * as nodeCrypto from "node:crypto";
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

const PRIVATE_RANGES = [
  /^127\./,
  /^0\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./,
  /^::1?$/,
  /^::ffff:/i,
  /^f[cd]/i,
  /^fe80:/i,
];

/** Throws if the URL's host resolves to a private/internal IP (SSRF guard). */
async function assertNoSSRF(url: string) {
  // URL parsing normalizes decimal/hex/octal IPv4 forms to dotted notation.
  const host = new URL(url).hostname.replace(/^\[|\]$/g, "");
  if (PRIVATE_RANGES.some((r) => r.test(host))) throw new Error(`SSRF blocked: ${host}`);
  const [ips, ips6] = await Promise.all([
    Deno.resolveDns(host, "A").catch(() => []),
    Deno.resolveDns(host, "AAAA").catch(() => []),
  ]);
  for (const ip of [...ips, ...ips6]) {
    if (PRIVATE_RANGES.some((r) => r.test(ip))) throw new Error(`SSRF blocked: ${ip}`);
  }
}

export async function safeFetch(url: string, init?: RequestInit, maxRedirects = 5): Promise<Response> {
  await assertNoSSRF(url);
  init = { ...init, signal: init?.signal ?? AbortSignal.timeout(15000) };
  const resp = await fetch(url, { ...init, redirect: "manual" });
  if ([301, 302, 303, 307, 308].includes(resp.status)) {
    const location = resp.headers.get("location");
    resp.body?.cancel().catch(() => {}); // don't leak the redirect body
    if (!location || maxRedirects <= 0) throw new Error("Too many redirects");
    return safeFetch(new URL(location, url).toString(), init, maxRedirects - 1);
  }
  return resp;
}
