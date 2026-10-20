import { contactOwner, sha256hex, unixTime } from "@qino/qino";
import { record } from "@qino/qino/messaging";

import { addressOf } from "./address.ts";
import { inbound } from "./settings.ts";
import { spamOf } from "./spam.ts";

import type { App } from "@qino/qino";

/** What the MIME parser hands back — only the parts this module reads. */
type Parsed = {
  subject?: string;
  text?: string;
  html?: string | false;
  messageId?: string;
  date?: Date;
  from?: { value: { address?: string; name?: string }[] };
  to?: { text?: string };
  attachments?: { filename?: string; contentType?: string; content: Uint8Array }[];
  headerLines?: { key: string; line: string }[];
};

/**
 * Import new mails into the journal without changing mailbox flags.
 *
 * Resolves with the number processed; 0 if disabled. A probe only connects and opens the mailbox.
 * The cursor advances only after a successful import; receipts survive deletion of journal entries.
 */
export async function receive(app: App, { limit = 50, probe }: { limit?: number; probe?: boolean } = {}): Promise<number> {
  const config = await inbound(app);
  if (!config.enabled && !probe) return 0;
  if (!config.host || !config.pass) throw new Error("Inbound email needs an IMAP host and password");

  const { ImapFlow } = await import("imapflow");
  const { simpleParser } = await import("mailparser") as { simpleParser: (source: Uint8Array) => Promise<Parsed> };
  const client = new ImapFlow({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.user, pass: config.pass },
    logger: false,
  });

  await client.connect();
  let done = 0;
  try {
    const lock = await client.getMailboxLock(config.mailbox);
    try {
      if (probe || limit <= 0) return 0;
      const mailbox = client.mailbox;
      if (!mailbox) throw new Error("Inbound mailbox is not open");
      const id = await sha256hex(JSON.stringify([config.host, config.port, config.user, config.mailbox]));
      const validity = String(mailbox.uidValidity);
      const table = app.db.table("email_inbox");
      const cursor = await app.db.row`SELECT uid, validity FROM email_inbox WHERE id = ${id}`;
      const uid = cursor?.validity === validity ? Number(cursor.uid) : 0;
      if (!cursor) await table.insert({ id, validity, uid });
      const last = mailbox.uidNext - 1;
      if (uid >= last) return 0;
      const uids = await client.search({ uid: `${uid + 1}:${last}` }, { uid: true });
      if (!uids || !uids.length) return 0;
      uids.sort((a, b) => a - b);
      // No other IMAP command may run while a fetch streams — finish fetching before importing.
      const messages = await client.fetchAll(uids.slice(0, limit), { uid: true, source: true }, { uid: true });
      for (const message of messages.sort((a, b) => a.uid - b.uid)) {
        try {
          if (!message.source) throw new Error("Inbound message has no source");
          const mail = await simpleParser(message.source);
          // The Message-ID survives renumbering; without one only identical source can be recognized.
          const receipt = mail.messageId
            ? await sha256hex(`id:${mail.messageId}`)
            : await sha256hex(`source:${new Uint8Array(await crypto.subtle.digest("SHA-256", message.source.slice())).toHex()}`);
          await app.db.transaction(async () => {
            if (!await app.db.one`SELECT id FROM email_import WHERE id = ${receipt}`) {
              await journal(app, mail, config.address);
              await app.db.table("email_import").insert({ id: receipt });
            }
            await table.update(id, { validity, uid: message.uid });
          });
          done++;
        } catch (e) {
          console.error("[email] inbound message failed —", e);
          break;
        }
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout();
  }
  return done;
}

/** One incoming mail as a journal entry, tied to the user the address belongs to. */
async function journal(app: App, mail: Parsed, to: string) {
  // the Message-ID is the far side's name for it: a mail already journaled is not taken twice
  if (mail.messageId && await app.db.one`SELECT d.id FROM message_delivery d JOIN message m ON m.id = d.message_id
    WHERE d.external_id = ${mail.messageId} AND m.channel = ${"email"}`) return;
  const sender = addressOf(mail.from?.value?.[0] ?? "");
  const usrId = sender ? await contactOwner(app.db, "email", sender.address) : undefined;
  const time = mail.date ? Math.floor(mail.date.getTime() / 1000) : unixTime();
  const spam = await spamOf(app, mail, { from: sender?.address, usrId, to });
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
    data: { from: sender?.address, name: sender?.name, to: mail.to?.text ?? to, html: mail.html || undefined },
    time,
    spam,
  }, [{ usrId, address: sender?.address, externalId: mail.messageId?.slice(0, 191), sent: unixTime() }]);
}
