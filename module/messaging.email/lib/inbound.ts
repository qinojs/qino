import { contactOwner, unixTime } from "@qino/qino";
import { record } from "@qino/qino/messaging";

import { addressOf } from "./address.ts";
import { inbound } from "./settings.ts";

import type { App } from "@qino/qino";

/** What the IMAP client and the MIME parser hand back — only the parts this module reads. */
type Fetched = { uid: number; source: Uint8Array };
type Parsed = {
  subject?: string;
  text?: string;
  html?: string | false;
  messageId?: string;
  date?: Date;
  from?: { value: { address?: string; name?: string }[] };
  to?: { text?: string };
  attachments?: { filename?: string; contentType?: string; content: Uint8Array }[];
};

/**
 * Read what is new in the configured mailbox into the journal and mark it seen.
 *
 * Resolves with the number of messages taken over; 0 while receiving is disabled. A probe only
 * connects and opens the mailbox. Seen is the only bookkeeping — a message the app crashed on
 * stays unseen and arrives with the next run.
 */
export async function receive(app: App, { limit = 50, probe }: { limit?: number; probe?: boolean } = {}): Promise<number> {
  const config = await inbound(app);
  if (!config.enabled && !probe) return 0;
  if (!config.host || !config.pass) throw new Error("Inbound email needs an IMAP host and password");

  const { ImapFlow } = await import("npm:imapflow@^1") as { ImapFlow: new (options: unknown) => ImapClient };
  const { simpleParser } = await import("npm:mailparser@^3") as { simpleParser: (source: Uint8Array) => Promise<Parsed> };
  const client = new ImapFlow({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.user, pass: config.pass },
    logger: false,
  });

  await client.connect();
  const lock = await client.getMailboxLock(config.mailbox);
  const done: number[] = [];
  try {
    if (probe) return 0;
    // No other IMAP command may run while a fetch streams — flag the uids once the loop is closed.
    for await (const message of client.fetch({ seen: false }, { uid: true, source: true })) {
      if (done.length >= limit) break;
      try {
        await journal(app, await simpleParser(message.source), config.address);
        done.push(message.uid);
      } catch (e) {
        console.error("[email] inbound message failed —", e);
      }
    }
    if (done.length) await client.messageFlagsAdd(done.join(","), ["\\Seen"], { uid: true });
  } finally {
    lock.release();
    await client.logout();
  }
  return done.length;
}

/** One incoming mail as a journal entry, tied to the user the address belongs to. */
async function journal(app: App, mail: Parsed, to: string): Promise<void> {
  const sender = addressOf(mail.from?.value?.[0] ?? "");
  const usrId = sender ? await contactOwner(app.db, "email", sender.address) : undefined;
  const time = mail.date ? Math.floor(mail.date.getTime() / 1000) : unixTime();
  await record(app, {
    channel: "email",
    direction: "in",
    msg: {
      title: String(mail.subject ?? ""),
      text: String(mail.text ?? ""),
      attachments: mail.attachments?.map((file) => ({
        name: file.filename || "attachment",
        type: file.contentType,
        content: file.content,
      })),
    },
    data: { messageId: mail.messageId, from: sender?.address, name: sender?.name, to: mail.to?.text ?? to, html: mail.html || undefined },
    time,
  }, [{ usrId, address: sender?.address, sent: unixTime() }]);
}

type ImapClient = {
  connect(): Promise<void>;
  logout(): Promise<void>;
  getMailboxLock(mailbox: string): Promise<{ release(): void }>;
  fetch(range: unknown, options: unknown): AsyncIterable<Fetched>;
  messageFlagsAdd(range: unknown, flags: string[], options: unknown): Promise<boolean>;
};
