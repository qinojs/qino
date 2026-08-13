import { getCtx, hee, uid, type App } from "@qino/qino";
import { clean, importUpyo, renderMarkers, toBool, toInt, trackCert, trackURL } from "./helpers.ts";
import { MailMessage } from "./MailMessage.ts";
import { transports } from "./transport.ts";
import type { Dict, MailDefaults, Recipient, Template, TemplateData, Transport, TransportCtor } from "./types.ts";

const defaultTemplate: Template = ({ main }) => `<!DOCTYPE html>
<html>
  <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
  <body style="margin:0;font-family:Arial,sans-serif;font-size:14px;line-height:1.5">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td style="padding:24px">${main}</td></tr></table>
  </body>
</html>`;

// Per-app instances; the plugin's init binds, mail()/mail.get() read. Internal — mod.ts does not export it.
export const mailInstances = new WeakMap<object, MailManager>();

export class MailManager {
  templates: Record<string, Template> = { default: defaultTemplate };
  #transport?: Transport;
  #builtTransport?: Transport;
  #builtKey = "";
  #app: App;
  get app(): App { return this.#app; }

  constructor(app: App) { this.#app = app; }

  build(values: Dict = {}): MailMessage {
    return Object.assign(new MailMessage(this), values);
  }

  create(values: Dict = {}): Promise<MailMessage> {
    return this.build(values).create();
  }

  async get(id: string | number): Promise<MailMessage> {
    const row = await this.app.db.row`SELECT * FROM mail WHERE id = ${id}`;
    if (!row) throw new Error(`Mail not found: ${id}`);
    const mail = new MailMessage(this, String(id), row);
    mail.persist = true;
    return mail;
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
    const transport = this.#transport ?? this.#builtTransport;
    await transport?.closeAllConnections?.();
    await transport?.close?.();
  }

  async defaults(): Promise<MailDefaults> {
    const root = this.app.settings.mail;
    return {
      sender: String(await root.sender ?? ""),
      sendername: String(await root.sendername ?? ""),
      reply_to: String(await root.reply_to ?? ""),
      debug_to: String(await root.debug_to ?? ""),
      base_url: String(await root.base_url ?? ""),
    };
  }

  async secure(): Promise<string> {
    const root = this.app.settings.mail;
    let secret = String(await root._secure ?? "");
    if (!secret) await root._secure(secret = uid());
    return secret;
  }

  async trackHtml(recipient: Recipient, html: string): Promise<string> {
    const trackId = recipient.mail1_track_id;
    if (!trackId) return html;
    const base = await this.baseURL();
    if (!base) return html;
    const secret = await this.secure();
    const pixel = new URL("blank.gif", base);
    pixel.searchParams.set("mail1tr", `${trackId}-${trackCert(secret, trackId)}`);
    html += `<img src="${hee(pixel.href)}" width="2" height="2" style="margin-top:-2px" alt="">`;
    return html.replace(/(<a\b[^>]*\bhref=["'])([^"']+)/gi, (_m, pre, href) => pre + (trackURL(href, base, secret, trackId) || href));
  }

  async baseURL(): Promise<string> {
    const base = (await this.defaults()).base_url;
    if (base) return base.replace(/\/?$/, "/");
    try {
      const ctx = getCtx();
      return new URL(ctx.req.appUrl, ctx.req.url.href).href;
    } catch { return ""; }
  }

  async transport(): Promise<Transport> {
    if (this.#transport) return this.#transport;
    const config = await this.transportConfig();
    const key = JSON.stringify(config);
    if (this.#builtTransport && this.#builtKey === key) return this.#builtTransport;

    await this.#builtTransport?.close?.();
    const entry = transports[config.type];
    if (!entry) throw new Error(`Unknown mail transport "${config.type}"`);
    const transportClass = (await importUpyo(config.type))[entry.exportName] as TransportCtor | undefined;
    if (!transportClass) throw new Error(`Upyo transport export missing: ${entry.exportName}`);
    this.#builtKey = key;
    return this.#builtTransport = new transportClass(config.options);
  }

  async transportConfig(): Promise<{ type: string; options: Dict }> {
    const root = this.app.settings.mail.transport;
    let type = String(await root.type ?? "").toLowerCase();
    if (!type && this.app.dev) type = "mock";
    if (!type) throw new Error("No mail transport configured. Set mail.transport.type or inject mail(app).setTransport().");
    const get = (key: string) => root[type][key];
    const options: Dict = {};

    if (type === "smtp") {
      const host = await get("host");
      if (!host) throw new Error("SMTP transport needs mail.transport.smtp.host");
      const port = toInt(await get("port"));
      const user = await get("username");
      const pass = await get("password");
      Object.assign(options, { host, port, secure: toBool(await get("secure")) ?? port === 465 });
      if (user || pass) options.auth = { user, pass };
    } else {
      for (const key of transports[type]?.keys ?? []) options[key] = await get(key);
      if (type === "ses") {
        const { accessKeyId, secretAccessKey, sessionToken } = options;
        options.authentication = sessionToken
          ? { type: "session", accessKeyId, secretAccessKey, sessionToken }
          : { type: "credentials", accessKeyId, secretAccessKey };
      }
    }
    return { type, options: clean(options) };
  }

  async renderTemplate(name: string | Template | undefined, data: TemplateData): Promise<string> {
    const tpl = typeof name === "function" ? name : this.templates[name || "default"];
    if (!tpl) return data.main;
    return typeof tpl === "function" ? await tpl(data) : renderMarkers(tpl, { ...data.data, main: data.main }, ["main"]);
  }
}
