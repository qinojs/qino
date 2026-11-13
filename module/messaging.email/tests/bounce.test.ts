import { test } from "node:test";
import { Db } from "@qino/qino";
import { assert, assertEquals, contactDbSchema, messagingDbSchema } from "@qino/qino/tests";
import { simpleParser } from "mailparser";

import { bounced, bounces, failure } from "../lib/bounce.ts";

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

test("only permanent failures about the mailbox count as bounces", async () => {
  const mail = await report([
    ["Gone@Example.test", "failed", "5.1.1"],
    ["blocked@example.test", "failed", "5.7.1"], // policy: says nothing about the mailbox
    ["later@example.test", "delayed", "4.2.2"],
  ]);
  assertEquals(bounces(mail), [{ address: "gone@example.test", reason: "550 5.1.1 <Gone@Example.test>: Recipient address rejected: User unknown" }]); // the server's words, verbatim

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
  await bounced(app, mail, bounces(mail));
  assertEquals(await db.col`SELECT error IS NOT NULL FROM message_delivery ORDER BY id`, [1, 0], "the returned mail's delivery, not the latest");
  assertEquals(await db.one`SELECT error FROM usr_contact`, "550 5.1.1 <gone@example.test>: Recipient address rejected: User unknown");

  await db.exec`UPDATE usr_contact SET error = NULL`;
  const unnamed = await report([["gone@example.test", "failed", "5.1.1"]], "<elsewhere@mx.example>");
  await bounced(app, unnamed, bounces(unnamed));
  assertEquals(await db.col`SELECT error IS NOT NULL FROM message_delivery ORDER BY id`, [1, 0], "no guessing which delivery it was");
  assert(await db.one`SELECT error FROM usr_contact`, "but the address did bounce");

  const unknown = await report([["stranger@example.test", "failed", "5.1.1"]]);
  await bounced(app, unknown, bounces(unknown));
  assertEquals(await db.one`SELECT COUNT(*) FROM message_delivery WHERE error IS NOT NULL`, 1, "a report about a mail never sent changes nothing");
  assertEquals(newer, answered + 1);
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
