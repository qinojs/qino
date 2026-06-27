import * as nodeCrypto from "node:crypto";
import { typeByExtension } from "../../../deps.ts";

export interface UploadedFile {
  name: string;
  type: string;
  size: number;
  tmpPath: string;
  md5: string;
}

export async function readUploadFile(file: File, opt: { maxSize?: number } = {}): Promise<UploadedFile> {
  const tmp = await saveStream(file.stream(), opt);
  return { name: file.name, type: file.type, size: tmp.size, tmpPath: tmp.path, md5: tmp.md5};
}

export async function fetchRemoteFile(opt: { url: string; maxSize: number }): Promise<UploadedFile> {
  const resp = await safeFetch(opt.url);
  if (!resp.ok) throw new Error(`Remote file import failed: HTTP ${resp.status}`);
  const len = parseInt(resp.headers.get("content-length") ?? "0");
  if (len && len > opt.maxSize) throw new Error("Remote file too large");
  if (!resp.body) throw new Error("Remote file has no body");
  const file = await saveStream(resp.body, { prefix: "remote-", maxSize: opt.maxSize });

  const m = (resp.headers.get("content-disposition") ?? "").match(/filename="([^"]+)"/);
  const name = (m?.[1] ?? new URL(opt.url).pathname.split("/").pop() ?? "file").replace(/\?.*/, "").split(/[\\/]/).pop() || "file";
  const type = (resp.headers.get("content-type") ?? "").replace(/;.*/, "") || typeByExtension(name.replace(/.*\./, "").toLowerCase()) || "";
  return { name, type, size: file.size, tmpPath: file.path, md5: file.md5 };
}

async function saveStream(stream: ReadableStream<Uint8Array>, opt: { maxSize?: number; prefix?: string; dir?: string } = {}) {
  const tmpOpt: { prefix?: string; dir?: string } = {};
  if (opt.prefix) tmpOpt.prefix = opt.prefix;
  if (opt.dir) tmpOpt.dir = opt.dir;

  const path = await Deno.makeTempFile(tmpOpt);
  const file = await Deno.open(path, { write: true });
  const hash = nodeCrypto.createHash("md5");
  let size = 0;
  let failed = false;
  try {
    for await (const chunk of stream) {
      size += chunk.length;
      if (opt.maxSize && size > opt.maxSize) throw new Error("Stream too large");
      hash.update(chunk);
      await writeAll(file, chunk);
    }
  } catch (e) {
    failed = true;
    throw e;
  } finally {
    file.close();
    if (failed) await Deno.remove(path).catch(() => {});
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
export async function assertNoSSRF(url: string) {
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

export async function safeFetch(url: string, maxRedirects = 5): Promise<Response> {
  await assertNoSSRF(url);
  const resp = await fetch(url, { redirect: "manual" });
  if (resp.status >= 300 && resp.status < 400) {
    const location = resp.headers.get("location");
    if (!location || maxRedirects <= 0) throw new Error("Too many redirects");
    return safeFetch(new URL(location, url).toString(), maxRedirects - 1);
  }
  return resp;
}
