import { contactError, sql } from "@qino/qino";

import { addressOf } from "./address.ts";

import type { App } from "@qino/qino";
import type { ParsedMail } from "mailparser";

// Delivery status notifications (RFC 3464): a server reporting that a mail could not be delivered.
// mailparser keeps the status part in `text`, so the report type decides whether it is one.

/** A recipient a status report says failed permanently, with the server's reason. */
type Failed = { address: string; reason: string; status: string };

/** The recipients a status report says failed permanently. */
export function bounces(mail: ParsedMail): Failed[] {
  const type = mail.headers.get("content-type") as { value?: string; params?: Record<string, string> } | undefined;
  if (type?.value !== "multipart/report" || type.params?.["report-type"] !== "delivery-status") return [];
  // per-recipient fields follow the per-message block, each block ends with a blank line
  return String(mail.text ?? "").split(/\r?\n[ \t]*\r?\n/).flatMap((block) => {
    const field = (name: string) =>
      block.match(new RegExp(`^${name}:[ \\t]*(.*(?:\\r?\\n[ \\t].*)*)`, "im"))?.[1].replace(/\s+/g, " ").trim();
    const address = addressOf(field("Final-Recipient")?.replace(/^rfc822;/i, "") ?? "")?.address;
    const status = field("Status") ?? "";
    if (!address || field("Action")?.toLowerCase() !== "failed" || !/^5\./.test(status)) return []; // 5.x.x: permanent
    return [{ address, status, reason: (field("Diagnostic-Code")?.replace(/^smtp;\s*/i, "") || status).slice(0, 255) }];
  });
}

/** The Message-ID of the returned mail, from its attached headers or copy. */
function returned(mail: ParsedMail) {
  const part = mail.attachments?.find((a) => a.contentType === "text/rfc822-headers" || a.contentType === "message/rfc822");
  return part?.content.toString().match(/^Message-ID:\s*(<[^>\r\n]+>)/im)?.[1];
}

/**
 * Note the failures; resolves with whether the report found its delivery.
 *
 * The delivery is the one whose `Message-ID` the report returns — each has its own, and guessing is
 * worse than not knowing. It gets the server's reason whatever failed, a forward included. The
 * contact is marked only if this app ever mailed the address, and not for `5.7.x`: that is a policy
 * verdict about the sender, not the mailbox.
 */
export async function bounced(app: App, mail: ParsedMail, failed: Failed[]): Promise<boolean> {
  const ours = sql`FROM message_delivery d JOIN message m ON m.id = d.message_id
    WHERE m.channel = ${"email"} AND m.direction = ${"out"} AND d.sent IS NOT NULL`;
  const messageId = returned(mail);
  const delivery = messageId && await app.db.one`SELECT d.id ${ours} AND d.external_id = ${messageId}`;
  if (delivery) await app.db.table("message_delivery").update(Number(delivery), { error: failed[0].reason });
  for (const { address, reason, status } of failed) {
    if (status.startsWith("5.7.")) continue;
    if (await app.db.one`SELECT d.id ${ours} AND d.address = ${address} LIMIT 1`) await contactError(app.db, "email", address, reason);
  }
  return !!delivery;
}

/** What went wrong with a delivery, as a kind a list can show and translate. */
export type Failure = "address" | "domain" | "full" | "disabled" | "size" | "refused" | "later" | "other";

/** By enhanced status code (RFC 3463) first, then by the wording servers commonly use. */
const KINDS: [Failure, RegExp, RegExp][] = [
  ["address", /^5\.1\.(1|6|10)$/, /user unknown|unknown (user|recipient)|no such user|does not exist|not found|mailbox unavailable|invalid recipient/i],
  ["domain", /^5\.(1\.2|4\.4)$/, /domain not found|host not found|no mx|nxdomain|name or service not known/i],
  ["full", /^[45]\.2\.2$/, /quota|mailbox (is )?full|insufficient storage/i],
  ["disabled", /^5\.2\.1$/, /disabled|inactive|suspended|deactivated/i],
  ["size", /^[45]\.3\.4$/, /too (large|big)|size limit/i],
  ["refused", /^5\.7\.\d+$/, /spam|blocked|blacklist|policy|reputation|spf|dkim|dmarc|not accepted|rejected/i],
  ["later", /^4\./, /^4\d\d\b/],
];

/** The kind of a delivery error — the server's reply itself stays on the delivery. */
export function failure(error: string): Failure {
  const code = error.match(/\b[245]\.\d{1,3}\.\d{1,3}\b/)?.[0];
  if (code) for (const [kind, codes] of KINDS) if (codes.test(code)) return kind;
  return KINDS.find(([, , words]) => words.test(error))?.[0] ?? "other";
}

/** A delivery error in a few words, in the reader's language. */
export function failureText(app: App, error: string): Promise<string> {
  const t = app.t.in("messaging.email");
  const kind = failure(error);
  if (kind === "address") return t`Address does not exist`;
  if (kind === "domain") return t`Domain does not exist`;
  if (kind === "full") return t`Mailbox full`;
  if (kind === "disabled") return t`Mailbox disabled`;
  if (kind === "size") return t`Message too large`;
  if (kind === "refused") return t`Refused by the receiving server`;
  if (kind === "later") return t`Not delivered yet`;
  return t`Not delivered`;
}
