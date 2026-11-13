import { contactError, sql } from "@qino/qino";
import { track, unsubscribeCode } from "@qino/qino/messaging";

import { addressOf } from "./address.ts";

import type { App, Row } from "@qino/qino";
import type { ParsedMail } from "mailparser";

// What a server reports back about a mail of ours: that it could not be delivered (RFC 3464, or
// plain text from older servers) or that the recipient called it spam (ARF, RFC 5965). Each names
// our mail by its Message-ID; a report that finds its delivery is used up, any other is a mail.

/** A recipient a report says failed permanently, with the server's reason. Plain text names none. */
type Failed = { address?: string; reason: string; status: string };

/** `report-type` of a `multipart/report`. mailparser keeps its status part in `text`. */
function reportType(mail: ParsedMail) {
  const type = mail.headers.get("content-type") as { value?: string; params?: Record<string, string> } | undefined;
  return type?.value === "multipart/report" ? type.params?.["report-type"] : undefined;
}

/** Handle a report about a mail we sent; resolves with whether it found its delivery. */
export async function reported(app: App, mail: ParsedMail): Promise<boolean> {
  if (reportType(mail) === "feedback-report") return complained(app, mail);
  const failed = bounces(mail);
  return failed.length > 0 && bounced(app, mail, failed);
}

/** The recipients a report says failed permanently. A plain one comes from the null sender every
 *  bounce has; its first permanent SMTP reply is the reason. */
export function bounces(mail: ParsedMail): Failed[] {
  const type = reportType(mail);
  if (type === "delivery-status") return statuses(String(mail.text ?? ""));
  const sender = mail.headers.get("return-path") as { text?: string } | undefined;
  if (type || sender?.text !== "") return [];
  const reply = String(mail.text ?? "").match(/\b5\d\d[ -](?:(5\.\d{1,3}\.\d{1,3})\s)?[^\r\n]+/);
  if (!reply) return [];
  const reason = reply[0].trim().slice(0, 255);
  return [{ reason, status: reply[1] ?? (failure(reason) === "refused" ? "5.7.0" : "5.0.0") }];
}

/** Per-recipient fields follow the per-message block, each block ends with a blank line. */
function statuses(text: string): Failed[] {
  return text.split(/\r?\n[ \t]*\r?\n/).flatMap((block) => {
    const field = (name: string) =>
      block.match(new RegExp(`^${name}:[ \\t]*(.*(?:\\r?\\n[ \\t].*)*)`, "im"))?.[1].replace(/\s+/g, " ").trim();
    const address = addressOf(field("Final-Recipient")?.replace(/^rfc822;/i, "") ?? "")?.address;
    const status = field("Status") ?? "";
    if (!address || field("Action")?.toLowerCase() !== "failed" || !/^5\./.test(status)) return []; // 5.x.x: permanent
    return [{ address, status, reason: (field("Diagnostic-Code")?.replace(/^smtp;\s*/i, "") || status).slice(0, 255) }];
  });
}

const ours = sql`FROM message_delivery d JOIN message m ON m.id = d.message_id
  WHERE m.channel = ${"email"} AND m.direction = ${"out"} AND d.sent IS NOT NULL`;

/** The delivery a report is about: the one whose Message-ID it returns, in an attached copy or its
 *  text — each has its own, and guessing is worse than not knowing. */
function delivery(app: App, mail: ParsedMail): Promise<Row | undefined> {
  const part = mail.attachments?.find((a) => a.contentType === "text/rfc822-headers" || a.contentType === "message/rfc822");
  const messageId = `${part?.content.toString() ?? ""}\n${mail.text ?? ""}`.match(/^[\s>]*Message-ID:\s*(<[^>\r\n]+>)/im)?.[1]; // quoted, too
  return messageId ? app.db.row`SELECT d.id, d.address, d.usr_id, m.grp_id ${ours} AND d.external_id = ${messageId}` : Promise.resolve(undefined);
}

/**
 * Note the failures. The delivery gets the server's reason whatever failed, a forward included. The
 * contact is marked only if this app ever mailed the address, and not for `5.7.x`: that is a policy
 * verdict about the sender, not the mailbox.
 */
export async function bounced(app: App, mail: ParsedMail, failed: Failed[]): Promise<boolean> {
  const found = await delivery(app, mail);
  if (found) await app.db.table("message_delivery").update(Number(found.id), { error: failed[0].reason });
  for (const { address = found?.address, reason, status } of failed) {
    if (!address || status.startsWith("5.7.")) continue;
    if (await app.db.one`SELECT d.id ${ours} AND d.address = ${address} LIMIT 1`) await contactError(app.db, "email", address, reason);
  }
  return !!found;
}

/** A spam complaint: the recipient wants no more of it. They leave the group, as if unsubscribing. */
async function complained(app: App, mail: ParsedMail): Promise<boolean> {
  const found = await delivery(app, mail);
  if (!found) return false;
  track(app, Number(found.id), unsubscribeCode, "click");
  if (found.usr_id && found.grp_id) await app.db.table("usr_grp").delete({ usr_id: found.usr_id, grp_id: found.grp_id });
  return true;
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
