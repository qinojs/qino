import type { App } from "@qino/qino";

// Settings are read leaf by leaf: awaiting a branch does not guarantee its children are loaded.
const root = (app: App) => app.settings["messaging.email"];
const str = async (value: unknown) => String(await value ?? "");

/** Who outgoing mail comes from, and where it goes while debugging. */
export async function defaults(app: App) {
  const s = root(app);
  const [address, name, debugTo, inbox] = await Promise.all([
    str(s.address), str(s.name), str(s.debugTo), str(s.inbound.address),
  ]);
  return { address, name, replyTo: inbox && inbox !== address ? inbox : undefined, debugTo };
}

/** Effective mailbox settings, inherited from SMTP where the protocols commonly share them. */
export async function inbound(app: App) {
  const email = root(app);
  const s = email.inbound;
  const smtp = email.transport.smtp;
  const [enabled, systemAddress, address, host, smtpHost, port, secure, user, smtpUser, pass, smtpPass, mailbox] = await Promise.all([
    s.enabled, str(email.address), str(s.address), str(s.host), str(smtp.host), s.port, s.secure,
    str(s.user), str(smtp.user), str(s.pass), str(smtp.pass), str(s.mailbox),
  ]);
  return {
    enabled: enabled === true || enabled === "true" || enabled === 1 || enabled === "1",
    address: address || systemAddress,
    host: host || smtpHost,
    port: Number(port) || 993,
    secure: secure == null || secure === "" ? Number(port) !== 143 : secure === true || secure === "true" || secure === 1,
    user: user || smtpUser || systemAddress,
    pass: pass || smtpPass,
    mailbox: mailbox || "INBOX",
  };
}

export const settingsSchema = {
  required: ["address"],
  properties: {
    address: { type: "string", description: "System email address and default From" },
    name: { type: "string", advanced: true, description: "Optional From display name" },
    debugTo: { type: "string", advanced: true, description: "Redirect all outgoing mail to this address" },
    inbound: {
      properties: {
        enabled: { type: "boolean", description: "Fetch incoming mail" },
        address: { type: "string", advanced: true, description: "Address receiving replies; the system address by default" },
        host: { type: "string", advanced: true, description: "IMAP host; the SMTP host by default" },
        port: { type: "number", advanced: true, default: 993, description: "IMAP port, 993 by default" },
        secure: { type: "boolean", advanced: true, default: true, description: "TLS; off means STARTTLS on port 143" },
        user: { type: "string", advanced: true, description: "IMAP user; the SMTP user, then system address by default" },
        pass: { type: "string", advanced: true, description: "IMAP password; the SMTP password by default" },
        mailbox: { type: "string", advanced: true, default: "INBOX", description: "IMAP folder to read; INBOX only by default" },
      },
    },
    transport: {
      properties: {
        type: { type: "string", enum: ["smtp", "mailgun", "resend", "sendgrid", "ses", "plunk", "jmap", "mock"], default: "smtp" },
        smtp: {
          properties: {
            host: { type: "string" },
            port: { type: "number", advanced: true, default: 465, description: "SMTP port, 465 by default" },
            secure: { type: "boolean", advanced: true, default: true },
            user: { type: "string", advanced: true, description: "SMTP user; the system address by default" },
            pass: { type: "string" },
          },
        },
        mailgun: { properties: { apiKey: { type: "string" }, domain: { type: "string" }, baseUrl: { type: "string", advanced: true } } },
        resend: { properties: { apiKey: { type: "string" }, baseUrl: { type: "string", advanced: true } } },
        sendgrid: { properties: { apiKey: { type: "string" }, baseUrl: { type: "string", advanced: true } } },
        ses: { properties: { region: { type: "string" }, accessKeyId: { type: "string" }, secretAccessKey: { type: "string" }, sessionToken: { type: "string", advanced: true } } },
        plunk: { properties: { apiKey: { type: "string" }, baseUrl: { type: "string", advanced: true } } },
        jmap: { properties: { sessionUrl: { type: "string" }, bearerToken: { type: "string" }, accountId: { type: "string" }, identityId: { type: "string" } } },
      },
    },
  },
};
