// deno-lint-ignore-file no-explicit-any
import { createHash } from "node:crypto";
import { basename, extname } from "node:path";
import { typeByExtension } from "../../deps.ts";
import { getCtx } from "../core/lib/RequestContext.ts";
import { hee, OutputDoneError, uid } from "../core/lib/util.ts";
import type { App } from "../core/server.ts";
import dbSchema from "./dbschema.json" with { type: "json" };

export const name = "mail";
export const needs = ["core"];
export { dbSchema };

type Dict = Record<string, any>;
type AddressInput = string | { address?: string; email?: string; name?: string; data?: Dict; mail1_track_id?: number };
type Template = string | ((data: TemplateData) => string | Promise<string>);
type Transport = { send(message: unknown, options?: unknown): Promise<any>; sendMany?: (messages: unknown, options?: unknown) => AsyncIterable<any> };

type TemplateData = {
  app: App;
  mail: MailMessage;
  main: string;
  data: Dict;
  recipient?: Recipient;
};

type Recipient = {
  address: string;
  name?: string;
  data?: Dict;
  mail1_track_id?: number;
};

type AttachmentInput = string | {
  path?: string;
  name?: string;
  filename?: string;
  type?: string;
  contentType?: string;
  content?: Uint8Array | Promise<Uint8Array> | Blob | File | string;
  contentId?: string;
  cid?: string;
  inline?: boolean;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const transportModules: Record<string, { module: string; exportName: string }> = {
  smtp:     { module: "smtp",     exportName: "SmtpTransport" },
  mailgun:  { module: "mailgun",  exportName: "MailgunTransport" },
  resend:   { module: "resend",   exportName: "ResendTransport" },
  sendgrid: { module: "sendgrid", exportName: "SendGridTransport" },
  ses:      { module: "ses",      exportName: "SesTransport" },
  plunk:    { module: "plunk",    exportName: "PlunkTransport" },
  jmap:     { module: "jmap",     exportName: "JmapTransport" },
  mock:     { module: "mock",     exportName: "MockTransport" },
};

export const settingsSchema = {
  properties: {
    sender:     { type: "string", description: "Default From email address" },
    sendername: { type: "string", description: "Default From display name" },
    reply_to:   { type: "string", description: "Default Reply-To email address" },
    debug_to:   { type: "string", description: "Redirect all outgoing mail to this address" },
    base_url:   { type: "string", description: "Public base URL for mail tracking links" },
    transport: {
      properties: {
        type: { type: "string", enum: ["", "smtp", "mailgun", "resend", "sendgrid", "ses", "plunk", "jmap", "mock"] },
        smtp: {
          properties: {
            host: { type: "string" },
            port: { type: "number" },
            secure: { type: "boolean" },
            username: { type: "string" },
            password: { type: "string" },
          },
        },
        mailgun: {
          properties: {
            apiKey: { type: "string" },
            domain: { type: "string" },
            baseUrl: { type: "string" },
          },
        },
        resend: {
          properties: {
            apiKey: { type: "string" },
            baseUrl: { type: "string" },
          },
        },
        sendgrid: {
          properties: {
            apiKey: { type: "string" },
            baseUrl: { type: "string" },
          },
        },
        ses: {
          properties: {
            region: { type: "string" },
            accessKeyId: { type: "string" },
            secretAccessKey: { type: "string" },
            sessionToken: { type: "string" },
          },
        },
        plunk: {
          properties: {
            apiKey: { type: "string" },
            baseUrl: { type: "string" },
          },
        },
        jmap: {
          properties: {
            sessionUrl: { type: "string" },
            bearerToken: { type: "string" },
            accountId: { type: "string" },
            identityId: { type: "string" },
          },
        },
        mock: {
          properties: {},
        },
      },
    },
  },
};

export function init(app: App): void {
  (app as any).mail = new MailManager(app);
  app.on("action", ({ ctx }: any) => handleTrack(ctx));
}

function addressOf(input: AddressInput, name = "", data: Dict = {}): Recipient | null {
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

function listOf(input: AddressInput | AddressInput[] | undefined): Recipient[] {
  const list = Array.isArray(input) ? input : input ? [input] : [];
  return list.map(v => addressOf(v)).filter(Boolean) as Recipient[];
}

function mergeHeaders(...headers: (HeadersInit | undefined)[]): Headers {
  const result = new Headers();
  for (const h of headers) {
    if (!h) continue;
    new Headers(h).forEach((v, k) => result.set(k, v));
  }
  return result;
}

function valueAt(data: Dict, path: string): unknown {
  return path.trim().split(".").reduce((v, key) => v?.[key], data);
}

function renderMarkers(tpl: string, data: Dict): string {
  tpl = tpl.replace(/\{\{\{\s*([^}]+?)\s*\}\}\}/g, (_, key) => String(valueAt(data, key) ?? ""));
  return tpl.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, key) => hee(valueAt(data, key) ?? ""));
}

function htmlToText(html: string): string {
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

async function importUpyo(pkg: string): Promise<any> {
  return await import(`jsr:@upyo/${pkg}`);
}

function clean(obj: Dict): Dict {
  for (const key of Object.keys(obj)) if (obj[key] === "" || obj[key] == null) delete obj[key];
  return obj;
}

function toBool(v: unknown): boolean | undefined {
  if (v === "" || v == null) return undefined;
  return v === true || v === 1 || v === "1" || v === "true";
}

function toInt(v: unknown): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function jsonEncode(v: unknown): string {
  if (v == null || v === "") return "";
  if (v instanceof Headers) return JSON.stringify(Object.fromEntries(v));
  if (Array.isArray(v) || typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function jsonDecode<T>(v: unknown, fallback: T): T {
  if (!v || typeof v !== "string") return fallback;
  try { return JSON.parse(v) as T; }
  catch { return fallback; }
}

async function readPath(root: any, path: string[]): Promise<any> {
  try {
    let item = root;
    for (const key of path) item = item[key];
    return await item;
  } catch { return undefined; }
}

async function firstSetting(root: any, paths: string[][]): Promise<any> {
  for (const path of paths) {
    const v = await readPath(root, path);
    if (v !== "" && v != null) return v;
  }
}

async function pathAttachment(v: string, opts: Dict = {}): Promise<any> {
  const filename = opts.name ?? opts.filename ?? basename(v);
  const contentType = opts.type ?? opts.contentType ?? typeByExtension(extname(v).replace(/^\./, "")) ?? "application/octet-stream";
  const contentId = opts.contentId ?? opts.cid ?? createHash("sha1").update(v).digest("hex");
  return clean({ filename, content: Deno.readFile(v), contentType, contentId, inline: !!opts.inline });
}

async function attachmentOf(v: AttachmentInput, inline = false): Promise<any> {
  if (typeof v === "string") return await pathAttachment(v, { inline });
  if (v.path) return await pathAttachment(v.path, { ...v, inline: v.inline ?? inline });
  return clean({
    filename: v.filename ?? v.name,
    content: v.content,
    contentType: v.contentType ?? v.type,
    contentId: v.contentId ?? v.cid,
    inline: !!(v.inline ?? inline),
  });
}

const BLANK_GIF = Uint8Array.from(atob("R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=="), c => c.charCodeAt(0));

function trackCert(secret: string, trackId: number): string {
  return createHash("sha1").update("mail1-track" + secret + trackId).digest("hex").slice(0, 8);
}

async function handleTrack(ctx: any): Promise<void> {
  const raw = String(ctx.get.mail1tr ?? "");
  if (!raw) return;
  const [idRaw, cert] = raw.split("-");
  const trackId = Number(idRaw);
  if (!trackId || !cert) return;

  const secret = await (ctx.app as any).mail.secure();
  if (cert !== trackCert(secret, trackId)) return;

  const recipient = await ctx.app.db.row("SELECT * FROM mail_recipient WHERE mail1_track_id = ?", [trackId]);
  if (!recipient) return;

  const url = String(ctx.get.url ?? "");
  await ctx.app.db.table("mail1_track").insert({
    track_id: trackId,
    url,
    time: Math.floor(Date.now() / 1000),
    log_id: ctx.logId ?? null,
  });
  if (!recipient.opened) {
    await ctx.app.db.table("mail_recipient").update(
      { mail_id: recipient.mail_id, email: recipient.email, opened: Math.floor(Date.now() / 1000) },
    );
  }

  if (ctx.appRequestUri === "blank.gif") {
    ctx.responseHeaders.set("Content-Type", "image/gif");
    ctx.responseBody = BLANK_GIF;
    throw new OutputDoneError();
  }
  if (ctx.appRequestUri === "mail-track" && url) {
    ctx.responseStatus = 302;
    ctx.responseHeaders.set("Location", url);
    throw new OutputDoneError();
  }
}

export class MailManager {
  app: App;
  templates: Record<string, Template> = {};
  #transport?: Transport;
  #builtTransport?: Transport;
  #builtKey = "";

  constructor(app: App) {
    this.app = app;
    this.templates.default = ({ main }) => `<!DOCTYPE html>
<html>
  <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
  <body style="margin:0;font-family:Arial,sans-serif;font-size:14px;line-height:1.5">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td style="padding:24px">${main}</td></tr></table>
  </body>
</html>`;
  }

  async create(values: Dict = {}): Promise<MailMessage> {
    const m = this.build(values);
    m.persist = true;
    await m.create();
    return m;
  }

  build(values: Dict = {}): MailMessage {
    return Object.assign(new MailMessage(this), values);
  }

  async get(id: string | number): Promise<MailMessage> {
    const row = await this.app.db.row("SELECT * FROM mail WHERE id = ?", [id]);
    if (!row) throw new Error(`Mail not found: ${id}`);
    const m = new MailMessage(this, String(id), row);
    m.persist = true;
    return m;
  }

  template(name: string, tpl: Template): this {
    this.templates[name] = tpl;
    return this;
  }

  setTransport(transport: Transport): this {
    this.#transport = transport;
    return this;
  }

  async close(): Promise<void> {
    const t: any = this.#transport ?? this.#builtTransport;
    await t?.closeAllConnections?.();
    await t?.close?.();
  }

  async defaults(): Promise<Dict> {
    const root = (this.app as any).settings;
    return {
      sender: await firstSetting(root, [["mail", "sender"], ["qg", "mail", "defSender"]]) ?? "",
      sendername: await firstSetting(root, [["mail", "sendername"], ["qg", "mail", "defSendername"]]) ?? "",
      reply_to: await firstSetting(root, [["mail", "reply_to"], ["mail", "replyTo"], ["qg", "mail", "replay"]]) ?? "",
      debug_to: await firstSetting(root, [["mail", "debug_to"], ["qg", "mail", "on debugmode to"]]) ?? "",
      base_url: await firstSetting(root, [["mail", "base_url"]]) ?? "",
    };
  }

  async secure(): Promise<string> {
    const root = (this.app as any).settings;
    let secret = String(await firstSetting(root, [["qg", "_secure"], ["mail", "_secure"]]) ?? "");
    if (!secret) {
      secret = uid();
      root.qg._secure = secret;
    }
    return secret;
  }

  async trackHtml(mail: MailMessage, recipient: Recipient, html: string): Promise<string> {
    const trackId = recipient.mail1_track_id;
    if (!trackId) return html;
    const base = await this.baseURL();
    if (!base) return html;
    const track = `${trackId}-${trackCert(await this.secure(), trackId)}`;
    const pixel = new URL("blank.gif", base);
    pixel.searchParams.set("mail1tr", track);
    html += `<img src="${hee(pixel.href)}" width="2" height="2" style="margin-top:-2px" alt="">`;

    return html.replace(/(<a\b[^>]*\bhref=["'])([^"']+)/gi, (_m, pre, href) => {
      const url = this.trackURL(href, base, track);
      return url ? pre + url : pre + href;
    });
  }

  async baseURL(): Promise<string> {
    const cfg = await this.defaults();
    if (cfg.base_url) return String(cfg.base_url).replace(/\/?$/, "/");
    try {
      const ctx = getCtx();
      return new URL(ctx.appURL, ctx.req.url).href;
    } catch { return ""; }
  }

  trackURL(raw: string, base: string, track: string): string | false {
    try {
      const target = new URL(raw, base);
      if (["cid:", "file:", "mailto:", "tel:"].includes(target.protocol)) return false;
      const url = new URL("mail-track", base);
      url.searchParams.set("mail1tr", track);
      url.searchParams.set("url", target.href);
      return url.href;
    } catch { return false; }
  }

  async transport(): Promise<Transport> {
    if (this.#transport) return this.#transport;

    const config = await this.transportConfig();
    const key = JSON.stringify(config);
    if (this.#builtTransport && this.#builtKey === key) return this.#builtTransport;

    const entry = transportModules[config.type];
    if (!entry) throw new Error(`Unknown mail transport "${config.type}"`);
    const mod = await importUpyo(entry.module);
    const TransportClass = mod[entry.exportName];
    if (!TransportClass) throw new Error(`Upyo transport export missing: ${entry.exportName}`);
    this.#builtTransport = new TransportClass(config.options);
    this.#builtKey = key;
    return this.#builtTransport!;
  }

  async transportConfig(): Promise<{ type: string; options: Dict }> {
    const root = (this.app as any).settings;
    let type = String(await firstSetting(root, [["mail", "transport", "type"]]) ?? "");
    if (!type && await firstSetting(root, [["mail", "transport", "host"], ["qg", "mail", "smtp", "host"]])) type = "smtp";
    if (!type && (this.app as any).config?.dev) type = "mock";
    if (!type) throw new Error("No mail transport configured. Set mail.transport.type or inject app.mail.setTransport().");
    type = type.toLowerCase();

    const get = (key: string) => firstSetting(root, [
      ["mail", "transport", type, key],
      ["mail", "transport", key],
    ]);
    const options: Dict = {};

    if (type === "smtp") {
      const host = await firstSetting(root, [["mail", "transport", "smtp", "host"], ["mail", "transport", "host"], ["qg", "mail", "smtp", "host"]]);
      if (!host) throw new Error("SMTP transport needs mail.transport.host");
      const port = toInt(await firstSetting(root, [["mail", "transport", "smtp", "port"], ["mail", "transport", "port"], ["qg", "mail", "smtp", "port"]]));
      const user = await firstSetting(root, [["mail", "transport", "smtp", "username"], ["mail", "transport", "username"], ["qg", "mail", "smtp", "username"]]);
      const pass = await firstSetting(root, [["mail", "transport", "smtp", "password"], ["mail", "transport", "password"], ["qg", "mail", "smtp", "password"]]);
      options.host = host;
      options.port = port;
      options.secure = toBool(await firstSetting(root, [["mail", "transport", "smtp", "secure"], ["mail", "transport", "secure"]])) ?? port === 465;
      if (user || pass) options.auth = { user, pass };
      return { type, options: clean(options) };
    }

    for (const key of ["apiKey", "key", "domain", "region", "baseUrl", "sessionUrl", "bearerToken", "accountId", "identityId", "timeout", "retries"]) {
      options[key] = await get(key);
    }
    options.apiKey ||= options.key;
    options.timeout = toInt(options.timeout);
    options.retries = toInt(options.retries);
    if (type === "ses") {
      const accessKeyId = await get("accessKeyId");
      const secretAccessKey = await get("secretAccessKey");
      const sessionToken = await get("sessionToken");
      options.authentication = sessionToken
        ? { type: "session", accessKeyId, secretAccessKey, sessionToken }
        : { type: "credentials", accessKeyId, secretAccessKey };
    }
    if (type === "mock") return { type, options: clean(options) };
    delete options.key;
    return { type, options: clean(options) };
  }

  async renderTemplate(name: string | Template | undefined, data: TemplateData): Promise<string> {
    const tpl = typeof name === "function" ? name : this.templates[name || "default"];
    if (!tpl) return data.main;
    if (typeof tpl === "function") return await tpl(data);
    return renderMarkers(tpl, { ...data.data, main: data.main });
  }
}

export class MailMessage {
  manager: MailManager;
  persist = false;
  id = "";
  from = "";
  sender = "";
  sendername = "";
  replyTo = "";
  reply_to = "";
  to: AddressInput | AddressInput[] = [];
  cc: AddressInput | AddressInput[] = [];
  bcc: AddressInput | AddressInput[] = [];
  subject = "";
  body = "";
  html = "";
  text = "";
  data: Dict = {};
  headers?: HeadersInit;
  tags?: string[];
  priority?: "high" | "normal" | "low";
  template: string | Template | false = "default";
  attachments: AttachmentInput[] = [];
  receipts: any[] = [];
  #pending: Promise<unknown>[] = [];
  #loaded = false;

  constructor(manager: MailManager, id = "", row?: Dict) {
    this.manager = manager;
    this.id = id;
    if (row) this.fromRow(row);
  }

  fromRow(row: Dict): this {
    this.id = String(row.id ?? this.id);
    this.sender = row.sender ?? "";
    this.from = row.sender ?? "";
    this.sendername = row.sendername ?? "";
    this.reply_to = row.reply_to ?? "";
    this.replyTo = row.reply_to ?? "";
    this.subject = row.subject ?? "";
    this.text = row.text ?? "";
    this.html = row.html ?? "";
    this.body = row.html ?? "";
    this.template = row.template || false;
    this.data = jsonDecode(row.data, {});
    this.headers = jsonDecode(row.headers, undefined);
    this.tags = jsonDecode(row.tags, undefined);
    this.priority = row.priority || undefined;
    return this;
  }

  async create(): Promise<this> {
    this.persist = true;
    if (this.id) return this;
    const defaults = await this.manager.defaults();
    const row = this.toRow(defaults);
    const id = await this.manager.app.db.table("mail").insert(row);
    if (!id) throw new Error("Mail could not be created");
    this.id = String(id);
    for (const r of listOf(this.to)) this.queueRecipient(r, "to");
    for (const r of listOf(this.cc)) this.queueRecipient(r, "cc");
    for (const r of listOf(this.bcc)) this.queueRecipient(r, "bcc");
    for (const a of this.attachments) this.queueAttachment(a);
    return this;
  }

  toRow(defaults: Dict = {}): Dict {
    const sender = this.sender || this.from || defaults.sender || "";
    const replyTo = this.replyTo || this.reply_to || defaults.reply_to || "";
    return {
      sender,
      sendername: this.sendername || defaults.sendername || "",
      reply_to: replyTo,
      subject: this.subject || "",
      text: this.text || "",
      html: this.html || this.body || "",
      template: typeof this.template === "string" ? this.template : "",
      data: jsonEncode(this.data),
      headers: jsonEncode(this.headers),
      tags: jsonEncode(this.tags),
      priority: this.priority || "",
    };
  }

  async save(): Promise<this> {
    if (!this.persist) return this;
    if (!this.id) await this.create();
    await Promise.all(this.#pending.splice(0));
    await this.manager.app.db.table("mail").update(this.id, this.toRow(await this.manager.defaults()));
    return this;
  }

  addTo(email: AddressInput, name = "", data: Dict = {}): this {
    const r = addressOf(email, name, data);
    if (r) {
      this.to = [...listOf(this.to), r];
      this.queueRecipient(r, "to");
    }
    return this;
  }

  addCc(email: AddressInput, name = "", data: Dict = {}): this {
    const r = addressOf(email, name, data);
    if (r) {
      this.cc = [...listOf(this.cc), r];
      this.queueRecipient(r, "cc");
    }
    return this;
  }

  addBcc(email: AddressInput, name = "", data: Dict = {}): this {
    const r = addressOf(email, name, data);
    if (r) {
      this.bcc = [...listOf(this.bcc), r];
      this.queueRecipient(r, "bcc");
    }
    return this;
  }

  queueRecipient(r: Recipient, type: "to" | "cc" | "bcc"): void {
    if (!this.id) return;
    this.#pending.push((async () => {
      const existing = await this.manager.app.db.row(
        "SELECT mail1_track_id FROM mail_recipient WHERE mail_id=? AND email=?",
        [this.id, r.address],
      );
      r.mail1_track_id = Number(existing?.mail1_track_id) || r.mail1_track_id || await this.nextTrackId();
      await this.manager.app.db.table("mail_recipient").ensure({
        mail_id: this.id,
        email: r.address,
        name: r.name ?? "",
        type,
        mail1_track_id: r.mail1_track_id,
        data: jsonEncode(r.data ?? {}),
        sent: 0,
        opened: 0,
        error: "",
      });
    })());
  }

  async nextTrackId(): Promise<number> {
    return Number(await this.manager.app.db.one("SELECT COALESCE(MAX(mail1_track_id),0)+1 FROM mail_recipient")) || 1;
  }

  async addUsr(usr: any): Promise<this> {
    const email = usr?.email ?? await usr?.get?.("email");
    const name = [
      usr?.firstname ?? await usr?.get?.("firstname"),
      usr?.lastname ?? await usr?.get?.("lastname"),
    ].filter(Boolean).join(" ");
    return this.addTo(email, name);
  }

  addFile(file: AttachmentInput, inline = false): string {
    const path = typeof file === "string" ? file : file.path ?? file.contentId ?? file.cid ?? file.filename ?? file.name ?? "";
    const cid = typeof file === "string" ? createHash("sha1").update(path).digest("hex") : file.contentId ?? file.cid ?? createHash("sha1").update(path).digest("hex");
    if (typeof file === "string") this.attachments.push({ path: file, inline, contentId: cid });
    else this.attachments.push({ ...file, inline: file.inline ?? inline, contentId: cid });
    this.queueAttachment(typeof file === "string" ? { path: file, inline, contentId: cid } : { ...file, inline: file.inline ?? inline, contentId: cid });
    return cid;
  }

  queueAttachment(vs: AttachmentInput): void {
    if (!this.id || typeof vs === "string" || !vs.path) return;
    if (this.id && vs.path) this.#pending.push(this.manager.app.db.table("mail_attachment").ensure({
      mail_id: this.id,
      hash: vs.contentId ?? vs.cid ?? createHash("sha1").update(vs.path).digest("hex"),
      path: vs.path,
      name: vs.name ?? vs.filename ?? basename(vs.path),
      type: vs.type ?? vs.contentType ?? typeByExtension(extname(vs.path).replace(/^\./, "")) ?? "",
      inline: vs.inline ? 1 : 0,
    }));
  }

  attach(file: AttachmentInput, inline = false): string {
    return this.addFile(file, inline);
  }

  async send(): Promise<boolean> {
    if (this.persist) {
      await this.save();
      this.#loaded = false;
      await this.loadParts();
    }
    const defaults = await this.manager.defaults();
    const recipients = listOf(this.to);
    if (!recipients.length) return true;

    const transport = await this.manager.transport();
    const attachments = await Promise.all(this.attachments.map(v => attachmentOf(v)));
    this.receipts = [];

    for (const recipient of recipients) {
      const debugTo = defaults.debug_to && addressOf(defaults.debug_to);
      const to = debugTo ?? recipient;
      const data = { ...this.data, ...recipient.data };
      const html = this.html || this.body ? await this.getHtml(recipient, data) : "";
      const text = this.getText(html, data);
      const headers = mergeHeaders(this.headers, { "X-Qino-Mail": "mail" });
      if (debugTo) {
        headers.set("X-Qino-Original-Recipient", recipient.address);
      }
      const { createMessage } = await importUpyo("core");
      const message = createMessage(clean({
        from: this.fromAddress(defaults),
        to: formatAddress(to),
        cc: listOf(this.cc).map(formatAddress),
        bcc: listOf(this.bcc).map(formatAddress),
        replyTo: this.replyTo || this.reply_to || defaults.reply_to || undefined,
        subject: (debugTo ? "Debug! " : "") + renderMarkers(this.subject, data),
        content: clean({
          html: debugTo ? `original receiver: ${hee(recipient.address)}<br><br>${html}` : html,
          text: debugTo ? `original receiver: ${recipient.address}\n\n${text}` : text,
        }),
        attachments,
        headers,
        tags: this.tags,
        priority: this.priority,
      }));
      try {
        const receipt = await transport.send(message);
        this.receipts.push(receipt);
        if (receipt?.successful) await this.markRecipient(recipient, { sent: Math.floor(Date.now() / 1000), error: "" });
        else await this.markRecipient(recipient, { error: receipt?.errorMessages?.join("\n") ?? "mail sending failed" });
      } catch (error) {
        console.error("mail sending failed:", error);
        this.receipts.push({ successful: false, error, errorMessages: [String(error)] });
        await this.markRecipient(recipient, { error: String(error) });
      }
    }
    return this.receipts.every(r => r?.successful);
  }

  async loadParts(): Promise<this> {
    if (!this.id || this.#loaded) return this;
    const memoryAttachments = this.attachments.filter(v => typeof v !== "string" && !v.path);
    const rows = await this.manager.app.db.all("SELECT * FROM mail_recipient WHERE mail_id = ? ORDER BY email", [this.id]);
    this.to = [];
    this.cc = [];
    this.bcc = [];
    for (const row of rows) {
      const r = { address: row.email, name: row.name || undefined, data: jsonDecode(row.data, {}), mail1_track_id: Number(row.mail1_track_id) || undefined };
      if (row.type === "cc") this.cc = [...listOf(this.cc), r];
      else if (row.type === "bcc") this.bcc = [...listOf(this.bcc), r];
      else if (!row.sent) this.to = [...listOf(this.to), r];
    }

    const attachments = await this.manager.app.db.all("SELECT * FROM mail_attachment WHERE mail_id = ?", [this.id]);
    this.attachments = [...attachments.map(row => ({
      path: row.path,
      name: row.name,
      type: row.type,
      contentId: row.hash,
      inline: !!row.inline,
    })), ...memoryAttachments];
    this.#loaded = true;
    return this;
  }

  async markRecipient(recipient: Recipient, values: Dict): Promise<void> {
    if (!this.id) return;
    await this.manager.app.db.table("mail_recipient").update({ mail_id: this.id, email: recipient.address, ...values });
  }

  async getHtml(recipient?: Recipient, data: Dict = {}): Promise<string> {
    let main = this.html || this.body;
    main = renderMarkers(main, data);
    const html = this.template === false
      ? main
      : await this.manager.renderTemplate(this.template, { app: this.manager.app, mail: this, main, data, recipient });
    return recipient && this.persist ? await this.manager.trackHtml(this, recipient, html) : html;
  }

  getText(html = "", data: Dict = {}): string {
    return renderMarkers(this.text || htmlToText(html || this.body), data);
  }

  fromAddress(defaults: Dict): string {
    const sender = this.sender || this.from || defaults.sender;
    if (!sender) throw new Error("Mail has no sender. Set mail.sender or m.from.");
    return formatAddress({ address: sender, name: this.sendername || defaults.sendername });
  }
}

function formatAddress(v: Recipient | { address?: string; email?: string; name?: string } | string): string {
  if (typeof v === "string") return v;
  const address = v.address ?? ("email" in v ? v.email : "") ?? "";
  return v.name ? `${v.name.replace(/"/g, '\\"')} <${address}>` : address;
}
