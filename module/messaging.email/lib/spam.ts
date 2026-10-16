import { spamScore } from "@qino/qino/security";

import type { App } from "@qino/qino";

/** A failed sender check: at DMARC the From is forged; SPF or DKIM alone often just mean forwarding
 *  or a mailing list. */
const FAILED = { dmarc: 0.9, spf: 0.3, dkim: 0.3 };
/** The receiving server's own filter (SpamAssassin, rspamd) says spam. */
const FLAGGED = 0.9;
const FLAGS = ["x-spam-flag", "x-spam-status", "x-spam"];

/** A mail as mailparser hands it over — only the parts read here. Header keys are lowercase. */
type Mail = { subject?: string; text?: string; headerLines?: { key: string; line: string }[] };

/** Independent signals, each 0 to 1, as one. */
const combine = (...signals: number[]) => 1 - signals.reduce((clean, p) => clean * (1 - p), 1);

/** What the receiving server says. Only the topmost Authentication-Results is its own, the ones below
 *  came with the mail; a spam flag only ever raises, so a forged one hurts no one but its sender. */
function verdict(lines: Mail["headerLines"] = []) {
  const auth = lines.find((h) => h.key === "authentication-results")?.line ?? "";
  const failed = Object.entries(FAILED).map(([check, p]) => new RegExp(`\\b${check}=fail\\b`, "i").test(auth) ? p : 0);
  const flagged = lines.some((h) => FLAGS.includes(h.key) && /^[^:]*:\s*yes\b/i.test(h.line));
  return combine(...failed, flagged ? FLAGGED : 0);
}

/** Mailed before, and the mail went out. */
const mailed = async (app: App, address: string) =>
  !!await app.db.one`SELECT d.id FROM message_delivery d JOIN message m ON m.id = d.message_id
    WHERE d.address = ${address} AND m.channel = ${"email"} AND m.direction = ${"out"}
    AND d.sent IS NOT NULL AND d.error IS NULL LIMIT 1`;

/**
 * How likely an incoming mail is spam, 0 to 1. A known sender (a user's address, or one mailed before)
 * is clean, unless a sender check failed — then the From may be forged. Otherwise the receiving
 * server's verdict and security's spamScore count.
 */
export async function spamOf(app: App, mail: Mail, { from, usrId, to }: { from?: string; usrId?: number; to: string }) {
  const server = verdict(mail.headerLines);
  if (!server && (usrId || from && await mailed(app, from))) return 0;
  const content = { Subject: mail.subject ?? "", Text: mail.text ?? "" };
  const score = await spamScore(app, content, { sender: from && `email:${from}`, context: `an email to ${to}` });
  return combine(server, score);
}
