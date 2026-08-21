import type { App } from "@qino/qino";

/** What a transport must offer; Upyo's classes satisfy it. */
export type Transport = {
  send(message: unknown): Promise<{ successful?: boolean; errorMessages?: string[] } | undefined>;
  close?(): Promise<void>;
  closeAllConnections?(): Promise<void>;
};

/** Upyo package name → its exported class and the settings keys it takes. */
const UPYO: Record<string, { exportName: string; keys: string[] }> = {
  smtp: { exportName: "SmtpTransport", keys: [] },
  mailgun: { exportName: "MailgunTransport", keys: ["apiKey", "domain", "baseUrl"] },
  resend: { exportName: "ResendTransport", keys: ["apiKey", "baseUrl"] },
  sendgrid: { exportName: "SendGridTransport", keys: ["apiKey", "baseUrl"] },
  ses: { exportName: "SesTransport", keys: ["region", "accessKeyId", "secretAccessKey", "sessionToken"] },
  plunk: { exportName: "PlunkTransport", keys: ["apiKey", "baseUrl"] },
  jmap: { exportName: "JmapTransport", keys: ["sessionUrl", "bearerToken", "accountId", "identityId"] },
  mock: { exportName: "MockTransport", keys: [] },
};

const injected = new WeakMap<object, Transport>();
const built = new WeakMap<object, { key: string; transport: Transport }>();

/** Send through this transport instead of the configured one — for tests and for apps that bring their own. */
export function setTransport(app: App, transport: Transport): void {
  injected.set(app, transport);
}

/** The configured transport, rebuilt whenever its settings change. */
export async function transport(app: App): Promise<Transport> {
  const own = injected.get(app);
  if (own) return own;
  const { type, options } = await config(app);
  const key = JSON.stringify([type, options]);
  const cached = built.get(app);
  if (cached?.key === key) return cached.transport;

  await close(app);
  const entry = UPYO[type];
  if (!entry) throw new Error(`Unknown email transport "${type}"`);
  const mod = await importUpyo(type);
  const ctor = mod[entry.exportName] as (new (options: Record<string, unknown>) => Transport) | undefined;
  if (!ctor) throw new Error(`Upyo transport export missing: ${entry.exportName}`);
  const fresh = new ctor(options);
  built.set(app, { key, transport: fresh });
  return fresh;
}

export async function close(app: App): Promise<void> {
  const cached = built.get(app);
  built.delete(app); // a closed transport must never be handed out again
  await cached?.transport.closeAllConnections?.();
  await cached?.transport.close?.();
}

/** Turns one message description into what the transport sends. */
export async function createMessage(message: Record<string, unknown>): Promise<unknown> {
  const core = await importUpyo("core");
  const create = core.createMessage as ((message: Record<string, unknown>) => unknown) | undefined;
  if (!create) throw new Error("Upyo createMessage export missing");
  return create(clean(message));
}

async function config(app: App): Promise<{ type: string; options: Record<string, unknown> }> {
  const root = app.settings["messaging.email"].transport;
  const type = String(await root.type || "smtp").toLowerCase();
  const get = (key: string) => root[type][key];
  const options: Record<string, unknown> = {};

  if (type === "smtp") {
    const host = await get("host");
    if (!host) throw new Error("SMTP transport needs messaging.email.transport.smtp.host");
    const port = Number(await get("port")) || 465;
    const user = await get("user") || await app.settings["messaging.email"].address;
    const pass = await get("pass");
    Object.assign(options, { host, port, secure: toBool(await get("secure")) ?? true });
    if (user || pass) options.auth = { user, pass };
  } else {
    for (const key of UPYO[type]?.keys ?? []) options[key] = await get(key);
    if (type === "ses") {
      const { accessKeyId, secretAccessKey, sessionToken } = options;
      options.authentication = sessionToken
        ? { type: "session", accessKeyId, secretAccessKey, sessionToken }
        : { type: "credentials", accessKeyId, secretAccessKey };
    }
  }
  return { type, options: clean(options) };
}

function importUpyo(pkg: string): Promise<Record<string, unknown>> {
  return import(`jsr:@upyo/${pkg}`);
}

function clean(obj: Record<string, unknown>): Record<string, unknown> {
  for (const key of Object.keys(obj)) if (obj[key] === "" || obj[key] == null) delete obj[key];
  return obj;
}

function toBool(v: unknown): boolean | undefined {
  if (v === "" || v == null) return;
  return v === true || v === 1 || v === "1" || v === "true";
}
