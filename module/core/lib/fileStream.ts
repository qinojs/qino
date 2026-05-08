import * as nodeCrypto from "node:crypto";
import { typeByExtension } from "../../../deps.ts";

export async function saveStream(stream: ReadableStream<Uint8Array>, opt: { maxSize?: number; prefix?: string; dir?: string } = {}) {
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

export async function readUploadFile(file: File, opt: { maxSize?: number } = {}) {
  const tmp = await saveStream(file.stream(), opt);
  return {
    name: file.name,
    type: file.type,
    size: tmp.size,
    tmpPath: tmp.path,
    md5: tmp.md5,
  };
}

export async function fetchRemoteFile(opt: { url: string; maxSize: number }) {
  const resp = await fetch(opt.url, { redirect: "follow" });
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

async function writeAll(file: Deno.FsFile, chunk: Uint8Array): Promise<void> {
  let written = 0;
  while (written < chunk.length) written += await file.write(chunk.subarray(written));
}
