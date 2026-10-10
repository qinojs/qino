import { extname } from "node:path";

import { contentType } from "../deps.ts";
import { fs } from "./fs.ts";

/** A file as `Response`, like a static file server: 304 for a matching `If-None-Match` or
 *  `If-Modified-Since`, a single byte `Range` as 206/416, 404 if there is no file. `headers` are sent
 *  along; an ETag, Last-Modified or Content-Type in them replaces the default. */
export async function serveFile(req: Request, path: string, headers: Headers = new Headers()): Promise<Response> {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return new Response(null, { status: 405, headers: { Allow: "GET, HEAD" } });
  }
  const info = await fs.stat(path);
  if (!info?.isFile) return new Response(null, { status: 404 });
  const { size, mtime } = info;

  const type = headers.get("Content-Type") ?? contentType(extname(path));
  if (type) headers.set("Content-Type", type);
  if (mtime && !headers.has("Last-Modified")) headers.set("Last-Modified", mtime.toUTCString());
  if (!headers.has("ETag")) headers.set("ETag", `"${size.toString(36)}-${(mtime?.getTime() ?? 0).toString(36)}"`);
  const etag = headers.get("ETag")!, modified = headers.get("Last-Modified");

  const inm = req.headers.get("If-None-Match");
  if (inm ? etagMatch(inm, etag) : Date.parse(req.headers.get("If-Modified-Since")!) >= Date.parse(modified!)) {
    return new Response(null, { status: 304, headers });
  }

  const send = async (status: number, range?: { start: number; end: number }) => {
    const stream = req.method === "HEAD" ? null : await fs.stream(path, range).catch(() => undefined);
    if (stream === undefined) return new Response(null, { status: 404 }); // gone since the stat
    // the size of what is streamed: the stream renewed the stat, the one above may be older
    const length = range ? range.end - range.start + 1 : stream ? (await fs.stat(path))?.size ?? size : size;
    headers.set("Content-Length", String(length));
    return new Response(stream, { status, headers });
  };

  headers.set("Accept-Ranges", "bytes");
  const ifRange = req.headers.get("If-Range"); // stale validator: send the whole file
  const m = size && (!ifRange || ifRange === etag || ifRange === modified)
    && req.headers.get("Range")?.match(/^bytes=(\d*)-(\d*)$/); // multi-range unsupported
  if (!m || (!m[1] && !m[2])) return send(200);
  const start = m[1] ? Number(m[1]) : Math.max(size - Number(m[2]), 0); // `-n` = last n bytes
  const end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  if (start > end) {
    headers.set("Content-Range", `bytes */${size}`);
    return new Response(null, { status: 416, headers });
  }
  headers.set("Content-Range", `bytes ${start}-${end}/${size}`);
  return send(206, { start, end });
}

/** `If-None-Match` per RFC 9110: a list, `*`, and weak tags all match. */
function etagMatch(header: string, etag: string) {
  return header === "*" || header.split(",").some((t) => t.trim().replace(/^W\//, "") === etag);
}
