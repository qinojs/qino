import type { App } from "@qino/qino";

// Settings are read leaf by leaf: awaiting a branch does not guarantee its children are loaded.
const root = (app: App) => app.settings["messaging.email"];
const str = async (value: unknown) => String(await value ?? "");

/** Who outgoing mail comes from, and where it goes while debugging. */
export async function defaults(app: App) {
  const s = root(app);
  const [sender, sendername, replyTo, debugTo, inbox] = await Promise.all([
    str(s.sender), str(s.sendername), str(s.reply_to), str(s.debug_to), str(s.inbound.address),
  ]);
  // a reply belongs where it can be read: the inbound mailbox, unless a reply-to is configured
  return { sender, sendername, replyTo: replyTo || inbox, debugTo };
}

/** Where replies and inbound mail arrive; an empty host means the module only sends. */
export async function inbound(app: App) {
  const s = root(app).inbound;
  const [address, host, port, secure, user, pass, mailbox] = await Promise.all([
    str(s.address), str(s.host), s.port, s.secure, str(s.user), str(s.pass), str(s.mailbox),
  ]);
  return {
    address,
    host,
    port: Number(port) || undefined,
    secure: secure == null || secure === "" ? Number(port) !== 143 : secure === true || secure === "true" || secure === 1,
    user: user || address,
    pass,
    mailbox: mailbox || "INBOX",
  };
}

export const settingsSchema = {
  properties: {
    sender: { type: "string", description: "Default From email address" },
    sendername: { type: "string", description: "Default From display name" },
    reply_to: { type: "string", description: "Default Reply-To; defaults to the inbound address" },
    debug_to: { type: "string", description: "Redirect all outgoing mail to this address" },
    inbound: {
      properties: {
        address: { type: "string", description: "The address this app receives on — replies land here" },
        host: { type: "string", description: "IMAP host; without it nothing is received" },
        port: { type: "number", description: "IMAP port, 993 by default" },
        secure: { type: "boolean", description: "TLS; off means STARTTLS on port 143" },
        user: { type: "string", description: "IMAP user; the inbound address by default" },
        pass: { type: "string" },
        mailbox: { type: "string", description: "Mailbox to read, INBOX by default" },
      },
    },
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
        mailgun: { properties: { apiKey: { type: "string" }, domain: { type: "string" }, baseUrl: { type: "string" } } },
        resend: { properties: { apiKey: { type: "string" }, baseUrl: { type: "string" } } },
        sendgrid: { properties: { apiKey: { type: "string" }, baseUrl: { type: "string" } } },
        ses: { properties: { region: { type: "string" }, accessKeyId: { type: "string" }, secretAccessKey: { type: "string" }, sessionToken: { type: "string" } } },
        plunk: { properties: { apiKey: { type: "string" }, baseUrl: { type: "string" } } },
        jmap: { properties: { sessionUrl: { type: "string" }, bearerToken: { type: "string" }, accountId: { type: "string" }, identityId: { type: "string" } } },
      },
    },
  },
};
