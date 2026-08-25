import { basename, extname } from "node:path";
import { typeByExtension } from "@std/media-types";
import { hee, mainContact, unixTime } from "@qino/qino";

import { addressOf, attachmentOf, clean, formatAddress, htmlToText, importUpyo, jsonDecode, jsonEncode, listOf, mergeHeaders, renderMarkers, sha1, textToHtml } from "./helpers.ts";

import type { MailManager } from "./MailManager.ts";
import type { AddressInput, AttachmentInput, Dict, MailDefaults, Recipient, RecipientType, SendReceipt, Template, UserInput } from "./types.ts";

export class MailMessage {
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
  template: string | Template | undefined = "default";
  attachments: AttachmentInput[] = [];
  receipts: SendReceipt[] = [];
  #pending: Promise<unknown>[] = [];
  #loaded = false;
  #manager: MailManager;
  get manager(): MailManager { return this.#manager; }

  constructor(manager: MailManager, id = "", row?: Dict) {
    this.#manager = manager;
    this.id = id;
    if (row) this.fromRow(row);
  }

  fromRow(row: Dict): this {
    const r = row as Record<string, string>;
    this.id = String(r.id ?? this.id);
    this.sender = this.from = r.sender ?? "";
    this.reply_to = this.replyTo = r.reply_to ?? "";
    this.sendername = r.sendername ?? "";
    this.subject = r.subject ?? "";
    this.text = r.text ?? "";
    this.html = this.body = r.html ?? "";
    this.template = r.template as Template || undefined;
    this.data = jsonDecode(r.data, {});
    this.headers = jsonDecode(r.headers, undefined);
    this.tags = jsonDecode(r.tags, undefined);
    this.priority = r.priority as MailMessage["priority"] || undefined;
    return this;
  }

  async create(): Promise<this> {
    this.persist = true;
    if (this.id) return this;
    const id = await this.manager.app.db.table("mail").insert(this.toRow(await this.manager.defaults()));
    if (!id) throw new Error("Mail could not be created");
    this.id = String(id);
    for (const type of ["to", "cc", "bcc"] as const) for (const r of listOf(this[type])) this.queueRecipient(r, type);
    for (const a of this.attachments) this.queueAttachment(a);
    return this;
  }

  toRow(defaults: Partial<MailDefaults> = {}): Dict {
    return {
      sender: this.sender || this.from || defaults.sender || "",
      sendername: this.sendername || defaults.sendername || "",
      reply_to: this.replyTo || this.reply_to || defaults.reply_to || "",
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

  #addRecipient(type: RecipientType, email: AddressInput, name = "", data: Dict = {}): this {
    const r = addressOf(email, name, data);
    if (r) {
      this[type] = [...listOf(this[type]), r];
      this.queueRecipient(r, type);
    }
    return this;
  }

  addTo(email: AddressInput, name = "", data: Dict = {}): this { return this.#addRecipient("to", email, name, data); }
  addCc(email: AddressInput, name = "", data: Dict = {}): this { return this.#addRecipient("cc", email, name, data); }
  addBcc(email: AddressInput, name = "", data: Dict = {}): this { return this.#addRecipient("bcc", email, name, data); }

  queueRecipient(r: Recipient, type: RecipientType): void {
    if (!this.id) return;
    this.#pending.push((async () => {
      const existing = await this.manager.app.db.row`SELECT mail1_track_id FROM mail_recipient WHERE mail_id=${this.id} AND email=${r.address}`;
      r.mail1_track_id = Number(existing?.mail1_track_id) || r.mail1_track_id || await this.nextTrackId();
      await this.manager.app.db.table("mail_recipient").ensure({
        mail_id: this.id,
        email: r.address,
        name: r.name ?? "",
        type,
        mail1_track_id: r.mail1_track_id,
        data: jsonEncode(r.data ?? {}),
        ...(r.usrId && { usr_id: r.usrId }), // only when known — never unset an existing link
        sent: 0,
        opened: 0,
        error: "",
      });
    })());
  }

  async nextTrackId(): Promise<number> {
    return Number(await this.manager.app.db.one`SELECT COALESCE(MAX(mail1_track_id),0)+1 FROM mail_recipient`) || 1;
  }

  /** Where the user reads mail — their verified contact, never the login handle `usr.username`. */
  async addUsr(usr: UserInput): Promise<this> {
    const usrId = Number(usr?.id ?? await usr?.get?.("id")) || undefined;
    const email = usrId && (await mainContact(this.manager.app.db, usrId, "email"))?.address;
    const name = [
      usr?.given_name ?? await usr?.get?.("given_name"),
      usr?.family_name ?? await usr?.get?.("family_name"),
    ].filter(Boolean).map(String).join(" ");
    return email ? this.addTo({ email: String(email), usrId }, name) : this;
  }

  addFile(file: AttachmentInput, inline = false): string {
    const data = typeof file === "string" ? { path: file } : file;
    const path = data.path ?? data.contentId ?? data.cid ?? data.filename ?? data.name ?? "";
    const cid = data.contentId ?? data.cid ?? sha1(path);
    const attachment = { ...data, inline: data.inline ?? inline, contentId: cid };
    this.attachments.push(attachment);
    this.queueAttachment(attachment);
    return cid;
  }

  queueAttachment(vs: AttachmentInput): void {
    if (!this.id || typeof vs === "string" || !vs.path) return;
    this.#pending.push(this.manager.app.db.table("mail_attachment").ensure({
      mail_id: this.id,
      hash: vs.contentId ?? vs.cid ?? sha1(vs.path),
      path: vs.path,
      name: vs.name ?? vs.filename ?? basename(vs.path),
      type: vs.type ?? vs.contentType ?? typeByExtension(extname(vs.path).replace(/^\./, "")) ?? "",
      inline: vs.inline ? 1 : 0,
    }));
  }

  attach(file: AttachmentInput, inline = false): string { return this.addFile(file, inline); }

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
    const core = await importUpyo("core");
    const createMessage = core.createMessage as ((message: Dict) => unknown) | undefined;
    if (!createMessage) throw new Error("Upyo createMessage export missing");
    const attachments = this.attachments.map(v => attachmentOf(v));
    const debugTo = defaults.debug_to ? addressOf(defaults.debug_to) : null;
    this.receipts = [];

    for (const recipient of recipients) {
      const data = { ...this.data, ...recipient.data };
      const html = this.html || this.body || (this.text && this.template !== undefined)
        ? await this.getHtml(recipient, data)
        : "";
      const text = this.getText(html, data);
      const headers = mergeHeaders(this.headers, { "X-Qino-Mail": "mail" });
      if (debugTo) headers.set("X-Qino-Original-Recipient", recipient.address);
      const message = createMessage(clean({
        from: this.fromAddress(defaults),
        to: formatAddress(debugTo ?? recipient),
        cc: debugTo ? [] : listOf(this.cc).map(formatAddress),
        bcc: debugTo ? [] : listOf(this.bcc).map(formatAddress),
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
        const receipt = await transport.send(message) as SendReceipt | undefined;
        const result = receipt ?? { successful: false, errorMessages: ["mail sending failed"] };
        this.receipts.push(result);
        await this.markRecipient(recipient, result.successful
          ? { sent: unixTime(), error: "" }
          : { error: result.errorMessages?.join("\n") ?? "mail sending failed" });
      } catch (error) {
        console.error("mail sending failed:", error);
        this.receipts.push({ successful: false, error, errorMessages: [String(error)] });
        await this.markRecipient(recipient, { error: String(error) });
      }
    }
    return this.receipts.every(r => r.successful);
  }

  async loadParts(): Promise<this> {
    if (!this.id || this.#loaded) return this;
    const memoryAttachments = this.attachments.filter(v => typeof v !== "string" && !v.path);
    const rows = await this.manager.app.db.query`SELECT * FROM mail_recipient WHERE mail_id = ${this.id} ORDER BY email`;
    this.to = []; this.cc = []; this.bcc = [];
    for (const row of rows) {
      const r = { address: row.email, name: row.name || undefined, data: jsonDecode(row.data, {}), mail1_track_id: Number(row.mail1_track_id) || undefined };
      const type: RecipientType = row.type === "cc" || row.type === "bcc" ? row.type : "to";
      if (type !== "to" || !row.sent) this[type] = [...listOf(this[type]), r];
    }
    const attachments = await this.manager.app.db.query`SELECT * FROM mail_attachment WHERE mail_id = ${this.id}`;
    this.attachments = [...attachments.map(row => ({
      path: row.path, name: row.name, type: row.type, contentId: row.hash, inline: !!row.inline,
    })), ...memoryAttachments];
    this.#loaded = true;
    return this;
  }

  async markRecipient(recipient: Recipient, values: Dict): Promise<void> {
    if (this.id) await this.manager.app.db.table("mail_recipient").update({ mail_id: this.id, email: recipient.address, ...values });
  }

  async getHtml(recipient?: Recipient, data: Dict = {}): Promise<string> {
    const main = renderMarkers(this.html || this.body || textToHtml(this.text), data);
    const html = this.template === undefined
      ? main
      : await this.manager.renderTemplate(this.template, { app: this.manager.app, mail: this, main, data, recipient });
    return recipient && this.persist ? this.manager.trackHtml(recipient, html) : html;
  }

  getText(html = "", data: Dict = {}): string {
    return renderMarkers(this.text || htmlToText(html || this.body), data);
  }

  fromAddress(defaults: Partial<MailDefaults>): string {
    const sender = this.sender || this.from || defaults.sender || "";
    if (!sender) throw new Error("Mail has no sender. Set mail.sender or m.from.");
    return formatAddress({ address: sender, name: this.sendername || String(defaults.sendername ?? "") });
  }
}
