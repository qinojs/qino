import { test } from "node:test";
import { Db } from "@qino/qino";
import { assert, assertEquals, contactDbSchema, messagingDbSchema } from "@qino/qino/tests";
import { simpleParser } from "mailparser";

import { bounced, bounces, failure, reported } from "../lib/bounce.ts";

import type { App } from "@qino/qino";

/** A status report as servers send it; `status` per recipient. */
const report = (recipients: [string, string, string][], returned = "<1@qino.test>") => simpleParser(`From: Mail Delivery System <MAILER-DAEMON@mx.example>
To: news@qino.test
Subject: Undelivered Mail Returned to Sender
Content-Type: multipart/report; report-type=delivery-status; boundary="B"

--B
Content-Type: text/plain

Your message could not be delivered.

--B
Content-Type: message/delivery-status

Reporting-MTA: dns; mx.example
${recipients.map(([address, action, status]) => `
Final-Recipient: rfc822; ${address}
Action: ${action}
Status: ${status}
Diagnostic-Code: smtp; 550 ${status} <${address}>: Recipient address
 rejected: User unknown
`).join("")}
--B
Content-Type: text/rfc822-headers

Message-ID: ${returned}
Subject: News

--B--
`);

test("only permanent failures count as bounces", async () => {
  const mail = await report([
    ["Gone@Example.test", "failed", "5.1.1"],
    ["blocked@example.test", "failed", "5.7.1"], // policy: not delivered all the same
    ["later@example.test", "delayed", "4.2.2"],
  ]);
  assertEquals(bounces(mail), [
    { address: "gone@example.test", status: "5.1.1", reason: "550 5.1.1 <Gone@Example.test>: Recipient address rejected: User unknown" }, // the server's words, verbatim
    { address: "blocked@example.test", status: "5.7.1", reason: "550 5.7.1 <blocked@example.test>: Recipient address rejected: User unknown" },
  ]);

  const plain = await simpleParser("From: someone@example.test\nSubject: Re: News\n\nFinal-Recipient: rfc822; gone@example.test\nAction: failed\nStatus: 5.1.1\n");
  assertEquals(bounces(plain), [], "a mail quoting a report is no report");
});

test("a bounce marks the delivery it answers and the contact", async () => {
  const db = new Db("sqlite::memory:");
  await db.migrate({ properties: { ...messagingDbSchema.properties, ...contactDbSchema.properties } });
  await db.loadTables();
  await db.table("usr_contact").insert({ type: "email", address: "gone@example.test", usr_id: 1, main: true, created: 1 });
  const message = Number(await db.table("message").insert({ channel: "email", direction: "out", data: "{}", time: 1 }));
  const delivery = (externalId: string, sent: number) =>
    db.table("message_delivery").insert({ message_id: message, usr_id: 1, address: "gone@example.test", external_id: externalId, sent });
  const answered = Number(await delivery("<1@qino.test>", 10));
  const newer = Number(await delivery("<2@qino.test>", 20));
  const app = { db } as unknown as App;

  const mail = await report([["gone@example.test", "failed", "5.1.1"]], "<1@qino.test>");
  assertEquals(await bounced(app, mail, bounces(mail)), true, "found its delivery: used up");
  assertEquals(await db.col`SELECT error IS NOT NULL FROM message_delivery ORDER BY id`, [1, 0], "the returned mail's delivery, not the latest");
  assertEquals(await db.one`SELECT error FROM usr_contact`, "550 5.1.1 <gone@example.test>: Recipient address rejected: User unknown");

  await db.exec`UPDATE usr_contact SET error = NULL`;
  const unnamed = await report([["gone@example.test", "failed", "5.1.1"]], "<elsewhere@mx.example>");
  assertEquals(await bounced(app, unnamed, bounces(unnamed)), false, "found none: a mail for the journal");
  assertEquals(await db.col`SELECT error IS NOT NULL FROM message_delivery ORDER BY id`, [1, 0], "no guessing which delivery it was");
  assert(await db.one`SELECT error FROM usr_contact`, "but the address did bounce");

  const unknown = await report([["stranger@example.test", "failed", "5.1.1"]]);
  await bounced(app, unknown, bounces(unknown));
  assertEquals(await db.one`SELECT COUNT(*) FROM message_delivery WHERE error IS NOT NULL`, 1, "a report about a mail never sent changes nothing");
  assertEquals(newer, answered + 1);

  // policy and forwards: the delivery failed, the mailbox says nothing
  await db.exec`UPDATE usr_contact SET error = NULL`;
  const refused = await report([["forward@elsewhere.test", "failed", "5.7.1"]], "<2@qino.test>");
  assertEquals(await bounced(app, refused, bounces(refused)), true);
  assertEquals(await db.col`SELECT error IS NOT NULL FROM message_delivery ORDER BY id`, [1, 1]);
  assertEquals(await db.one`SELECT error FROM usr_contact`, null);
  await db.close();
});

test("a delivery error comes down to its kind, by status code or by wording", () => {
  const replies: [string, string][] = [
    ["550-5.1.1 The email account that you tried to reach does not exist. Please try 550-5.1.1 double-checking", "address"],
    ["550 5.1.1 <a@b.test>: Recipient address rejected: User unknown in virtual mailbox table", "address"],
    ["550 5.1.10 RESOLVER.ADR.RecipientNotFound; Recipient p@b.test not found by SMTP address lookup", "address"],
    ["550-Requested action not taken: mailbox unavailable 550 For explanation visit https://postmaster.web.de/en/case?c=r1601", "address"],
    ["550-5.7.1 Messages with multiple addresses in From: header are 550-5.7.1 not accepted.", "refused"],
    ["552 5.2.2 Mailbox full", "full"],
    ["451 Temporary local problem", "later"],
    ["mail sending failed", "other"],
  ];
  for (const [reply, kind] of replies) assertEquals(failure(reply), kind, reply);
});

test("an older server's plain bounce and a spam complaint find their delivery by its Message-ID", async () => {
  const db = new Db("sqlite::memory:");
  await db.migrate({ properties: { ...messagingDbSchema.properties, ...contactDbSchema.properties } });
  await db.exec`CREATE TABLE usr_grp (usr_id INTEGER, grp_id INTEGER, PRIMARY KEY (usr_id, grp_id))`;
  await db.loadTables();
  await db.table("usr_contact").insert({ type: "email", address: "gone@example.test", usr_id: 1, main: true, created: 1 });
  await db.table("usr_grp").insert({ usr_id: 1, grp_id: 3 });
  const message = Number(await db.table("message").insert({ channel: "email", direction: "out", grp_id: 3, data: "{}", time: 1 }));
  const delivery = Number(await db.table("message_delivery").insert({ message_id: message, usr_id: 1, address: "gone@example.test", external_id: "<7@qino.test>", sent: 1 }));
  const app = { db } as unknown as App;

  const plain = await simpleParser(`Return-Path: <>\nFrom: MAILER-DAEMON@old.example\nSubject: failure notice\n
Sorry, I wasn't able to deliver your message.
<gone@example.test>:
550 5.1.1 Mailbox does not exist

--- Below this line is a copy of the message.
Message-ID: <7@qino.test>
Subject: News
`);
  assertEquals(await reported(app, plain), true);
  assertEquals(await db.one`SELECT error FROM message_delivery`, "550 5.1.1 Mailbox does not exist");
  assertEquals(await db.one`SELECT error FROM usr_contact`, "550 5.1.1 Mailbox does not exist", "the delivery's address bounced");

  // an auto-reply comes from the null sender too, and a phone number is no refusal
  await db.exec`UPDATE message_delivery SET error = NULL`;
  const away = await simpleParser("Return-Path: <>\nSubject: Out of office\n\nBack Monday. Urgent: 071 555 12 34\nMessage-ID: <7@qino.test>\n");
  assertEquals(await reported(app, away), false);
  assertEquals(await db.one`SELECT error FROM message_delivery`, null);

  const quoting = await simpleParser("From: someone@example.test\nSubject: Re: News\n\n550 5.1.1 Mailbox does not exist\nMessage-ID: <7@qino.test>\n");
  assertEquals(await reported(app, quoting), false, "a person's mail is no bounce, whatever it quotes");

  const complaint = await simpleParser(`From: staff@feedback.example
Subject: complaint about message
Content-Type: multipart/report; report-type=feedback-report; boundary="B"

--B
Content-Type: text/plain

This is an email abuse report.

--B
Content-Type: message/feedback-report

Feedback-Type: abuse

--B
Content-Type: text/rfc822-headers

Message-ID: <7@qino.test>

--B--
`);
  assertEquals(await reported(app, complaint), true);
  await new Promise((resolve) => setTimeout(resolve, 0)); // tracked in the background
  assertEquals(await db.one`SELECT COUNT(*) FROM usr_grp`, 0, "they leave the list");
  assertEquals(await db.query`SELECT delivery_id, code, kind FROM message_track`, [{ delivery_id: delivery, code: "unsubscribe", kind: "click" }], "as if unsubscribing");
  await db.close();
});
