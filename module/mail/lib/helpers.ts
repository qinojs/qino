import { createHash } from "node:crypto";
import { basename, extname } from "node:path";
import { typeByExtension } from "../../../deps.ts";
import { hee } from "../../core/mod.ts";
import type { AddressInput, AttachmentInput, Dict, Recipient } from "./types.ts";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function addressOf(input: AddressInput, name = "", data: Dict = {}): Recipient | null {
  let address = "";
  if (typeof input === "string") {
    const match = input.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
    if (match) { name ||= match[1].replace(/^"|"$/g, ""); address = match[2]; }
    else address = input;
  } else {
    address = input.address ?? input.email ?? "";
    name ||= input.name ?? "";
    data = { ...input.data, ...data };
  }
  address = address.trim().toLowerCase();
  if (!EMAIL_RE.test(address)) return null;
  return { address, name: name || undefined, data, mail1_track_id: typeof input === "object" ? input.mail1_track_id : undefined };
}

export function listOf(input: AddressInput | AddressInput[] | undefined): Recipient[] {
  const list = Array.isArray(input) ? input : input ? [input] : [];
  return list.flatMap(v => addressOf(v) ?? []);
}

export function mergeHeaders(...headers: (HeadersInit | undefined)[]): Headers {
  const result = new Headers();
  for (const h of headers) {
    if (!h) continue;
    new Headers(h).forEach((v, k) => result.set(k, v));
  }
  return result;
}

function valueAt(data: Dict, path: string): unknown {
  return path.trim().split(".").reduce((v: unknown, key) => (v as Record<string, unknown>)?.[key], data);
}

export function renderMarkers(tpl: string, data: Dict): string {
  return tpl.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, key) => hee(valueAt(data, key)));
}

export function htmlToText(html: string): string {
  return html
    .replace(/<(br|\/p|\/div|\/tr|\/h[1-6])\b[^>]*>/gi, "\n")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function importUpyo(pkg: string): Promise<Record<string, unknown>> {
  return import(`jsr:@upyo/${pkg}`);
}

export function clean(obj: Dict): Dict {
  for (const key of Object.keys(obj)) if (obj[key] === "" || obj[key] == null) delete obj[key];
  return obj;
}

export function toBool(v: unknown): boolean | undefined {
  if (v === "" || v == null) return;
  return v === true || v === 1 || v === "1" || v === "true";
}

export function toInt(v: unknown): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

export function jsonEncode(v: unknown): string {
  if (v == null || v === "") return "";
  if (v instanceof Headers) return JSON.stringify(Object.fromEntries(v));
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

export function jsonDecode<T>(v: unknown, fallback: T): T {
  if (!v || typeof v !== "string") return fallback;
  try { return JSON.parse(v) as T; }
  catch { return fallback; }
}

export function sha1(value: string): string {
  return createHash("sha1").update(value).digest("hex");
}

// Signs trackId and redirect target; "\n" delimits ambiguous id/url boundaries.
export const trackCert = (secret: string, trackId: number, url = ""): string =>
  sha1("mail1-track" + secret + trackId + "\n" + url).slice(0, 16);

function pathAttachment(v: string, opts: Dict = {}): Dict {
  const filename = opts.name ?? opts.filename ?? basename(v);
  const contentType = opts.type ?? opts.contentType ?? typeByExtension(extname(v).replace(/^\./, "")) ?? "application/octet-stream";
  const contentId = opts.contentId ?? opts.cid ?? sha1(v);
  return clean({ filename, content: Deno.readFile(v), contentType, contentId, inline: !!opts.inline });
}

export function attachmentOf(v: AttachmentInput, inline = false): Dict {
  if (typeof v === "string") return pathAttachment(v, { inline });
  if (v.path) return pathAttachment(v.path, { ...v, inline: v.inline ?? inline });
  return clean({
    filename: v.filename ?? v.name,
    content: v.content,
    contentType: v.contentType ?? v.type,
    contentId: v.contentId ?? v.cid,
    inline: !!(v.inline ?? inline),
  });
}

export function formatAddress(v: { address?: string; email?: string; name?: string } | string): string {
  if (typeof v === "string") return v;
  const address = v.address ?? v.email ?? "";
  return v.name ? `${v.name.replace(/"/g, '\\"')} <${address}>` : address;
}
