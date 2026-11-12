import { contactError, sql } from "@qino/qino";

import { addressOf } from "./address.ts";

import type { App } from "@qino/qino";
import type { ParsedMail } from "mailparser";

// Delivery status notifications (RFC 3464): a server reporting that a mail could not be delivered.
// mailparser keeps the status part in `text`, so the report type decides whether it is one.

/** The recipients a status report says failed permanently, with the server's reason. */
export function bounces(mail: ParsedMail): { address: string; reason: string }[] {
  const type = mail.headers.get("content-type") as { value?: string; params?: Record<string, string> } | undefined;
  if (type?.value !== "multipart/report" || type.params?.["report-type"] !== "delivery-status") return [];
  // per-recipient fields follow the per-message block, each block ends with a blank line
  return String(mail.text ?? "").split(/\r?\n[ \t]*\r?\n/).flatMap((block) => {
    const field = (name: string) =>
      block.match(new RegExp(`^${name}:[ \\t]*(.*(?:\\r?\\n[ \\t].*)*)`, "im"))?.[1].replace(/\s+/g, " ").trim();
    const address = addressOf(field("Final-Recipient")?.replace(/^rfc822;/i, "") ?? "")?.address;
    const status = field("Status") ?? "";
    // 5.x.x is permanent; 5.7.x is policy (spam, reputation) and says nothing about the mailbox
    if (!address || field("Action")?.toLowerCase() !== "failed" || !/^5\.(?!7\.)/.test(status)) return [];
    return [{ address, reason: (field("Diagnostic-Code")?.replace(/^smtp;\s*/i, "") || status).slice(0, 255) }];
  });
}

/** The Message-ID of the returned mail, from its attached headers or copy. */
function returned(mail: ParsedMail) {
  const part = mail.attachments?.find((a) => a.contentType === "text/rfc822-headers" || a.contentType === "message/rfc822");
  return part?.content.toString().match(/^Message-ID:\s*(<[^>\r\n]+>)/im)?.[1];
}

/**
 * Note each permanent failure on the contact, so the address shows as bounced — if this app ever
 * mailed it. The delivery is marked only if the report names the returned mail: guessing which one
 * it was is worse than not knowing.
 */
export async function bounced(app: App, mail: ParsedMail, failed: { address: string; reason: string }[]): Promise<void> {
  const messageId = returned(mail) ?? "";
  for (const { address, reason } of failed) {
    const ours = sql`FROM message_delivery d JOIN message m ON m.id = d.message_id
      WHERE m.channel = ${"email"} AND m.direction = ${"out"} AND d.address = ${address} AND d.sent IS NOT NULL`;
    const [answered, mailed] = await Promise.all([
      messageId && app.db.one`SELECT d.id ${ours} AND d.external_id = ${messageId}`,
      app.db.one`SELECT d.id ${ours} LIMIT 1`,
    ]);
    if (answered) await app.db.table("message_delivery").update(Number(answered), { error: reason });
    if (mailed) await contactError(app.db, "email", address, reason);
  }
}
