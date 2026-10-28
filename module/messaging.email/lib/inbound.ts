import { contactOwner, sha256hex, unixTime } from "@qino/qino";
import { record } from "@qino/qino/messaging";

import { addressOf } from "./address.ts";
import { inbound } from "./settings.ts";
import { spamOf } from "./spam.ts";

import type { App } from "@qino/qino";
import type { ParsedMail } from "mailparser";

/** Tries before a mail that keeps failing is skipped. */
const FAILS = 3;

/**
 * Import new mails into the journal without changing mailbox flags.
 *
 * Resolves with the number processed; 0 if disabled. A probe only connects and opens the mailbox.
 * The cursor advances with each import; receipts survive deletion of journal entries.
 */
export async function receive(app: App, { limit = 50, probe }: { limit?: number; probe?: boolean } = {}): Promise<number> {
  const config = await inbound(app);
  if (!config.enabled && !probe) return 0;
  if (!config.host || !config.pass) throw new Error("Inbound email needs an IMAP host and password");

  const { ImapFlow } = await import("imapflow");
  const { simpleParser } = await import("mailparser");
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
      if (probe) return 0;
      const mailbox = client.mailbox;
      if (!mailbox) throw new Error("Inbound mailbox is not open");
      const id = await sha256hex(JSON.stringify([config.host, config.port, config.user, config.mailbox]));
      const validity = String(mailbox.uidValidity);
      const inbox = app.db.table("email_inbox");
      const cursor = await app.db.row`SELECT uid, validity, failed FROM email_inbox WHERE id = ${id}`;
      const same = cursor?.validity === validity;
      let uid = same ? Number(cursor.uid) : 0, failed = same ? Number(cursor.failed) : 0;
      const last = mailbox.uidNext - 1;
      if (uid >= last) return 0;
      const uids = await client.search({ uid: `${uid + 1}:${last}` }, { uid: true });
      if (!uids || !uids.length) return 0;
      // No other IMAP command may run while a fetch streams — finish fetching before importing.
      const batch = uids.sort((a, b) => a - b).slice(0, limit);
      const messages = await client.fetchAll(batch, { uid: true, source: true }, { uid: true });
      for (const { uid: next, source } of messages.sort((a, b) => a.uid - b.uid)) {
        try {
          const mail = await simpleParser(source!);
          // The Message-ID survives renumbering; without one only identical source is recognized.
          const receipt = mail.messageId
            ? await sha256hex(mail.messageId)
            : new Uint8Array(await crypto.subtle.digest("SHA-256", source!.slice())).toHex();
          // Judged before the transaction: on SQLite it holds every other query.
          const write = !await taken(app, receipt, mail.messageId) && await journal(app, mail, config.address);
          await app.db.transaction(async () => {
            if (write) await write();
            await app.db.table("email_receipt").ensure({ id: receipt });
            await inbox.ensure({ id, validity, uid: next, failed: 0 });
          });
          uid = next, failed = 0, done++;
        } catch (e) {
          // A mail that keeps failing is skipped, or it would block the mailbox for good.
          const skip = ++failed >= FAILS;
          console.error(`[email] inbound mail ${next} failed${skip ? ", skipped" : ""} —`, e);
          if (skip) uid = next, failed = 0;
          await inbox.ensure({ id, validity, uid, failed });
          if (!skip) break;
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

/** Taken before: by its receipt, or as a journaled Message-ID — the far side's name for it. */
const taken = async (app: App, receipt: string, messageId?: string) =>
  !!(await app.db.one`SELECT id FROM email_receipt WHERE id = ${receipt}` || messageId && await app.db.one`
    SELECT d.id FROM message_delivery d JOIN message m ON m.id = d.message_id
    WHERE d.external_id = ${messageId} AND m.channel = ${"email"}`);

/** One incoming mail as a journal entry, tied to the user the address belongs to; resolves with its write. */
async function journal(app: App, mail: ParsedMail, to: string) {
  const sender = addressOf(mail.from?.value?.[0] ?? "");
  const usrId = sender ? await contactOwner(app.db, "email", sender.address) : undefined;
  const time = mail.date ? Math.floor(mail.date.getTime() / 1000) : unixTime();
  const spam = await spamOf(app, mail, { from: sender?.address, usrId, to });
  return () => record(app, {
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
    data: {
      from: sender?.address,
      name: sender?.name,
      to: [mail.to ?? []].flat().map((a) => a.text).join(", ") || to,
      html: mail.html || undefined,
    },
    time,
    spam,
  }, [{ usrId, address: sender?.address, externalId: mail.messageId?.slice(0, 191), sent: unixTime() }]);
}
