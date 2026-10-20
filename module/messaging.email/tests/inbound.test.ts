import { Buffer } from "node:buffer";

import { Db } from "@qino/qino";
import { assertEquals, messagingDbSchema } from "@qino/qino/tests";

import { receive } from "../lib/inbound.ts";
import { dbSchema } from "../plugin.ts";

import type { App } from "@qino/qino";

Deno.test({
  name: "inbound cursor and receipts survive deletion, renumbering and failed imports",
  // Optional IMAP dependencies read environment variables and hostname during initialization.
  ignore: Deno.permissions.querySync({ name: "env" }).state !== "granted" || Deno.permissions.querySync({ name: "sys", kind: "hostname" }).state !== "granted",
  fn: async () => {
    const { ImapFlow } = await import("imapflow") as unknown as { ImapFlow: { prototype: Record<string, unknown> } };
    const prototype = ImapFlow.prototype;
    const originals = Object.getOwnPropertyDescriptors(prototype);
    const db = new Db("sqlite::memory:");
    await db.migrate({ properties: { ...messagingDbSchema.properties, ...dbSchema.properties } });
    await db.loadTables();
    const app = {
      db,
      modules: { linked: () => undefined },
      settings: { "messaging.email": { address: "app@qino.test", inbound: { enabled: true, host: "mail.qino.test", pass: "secret" }, transport: { smtp: {} } } },
    } as unknown as App;
    const source = (id?: string) => Buffer.from(`${id ? `Message-ID: <${id}>\r\n` : ""}Subject: Hello\r\n\r\nBody`);
    let validity = 1n;
    let messages = [{ uid: 2, source: source("one") }, { uid: 5, source: source() }];
    let searches = 0, fetched: number[] = [], released = 0, closed = 0;
    Object.assign(prototype, {
      connect: () => Promise.resolve(),
      logout: () => { closed++; return Promise.resolve(); },
      getMailboxLock(this: { mailbox: unknown }) {
        this.mailbox = { uidValidity: validity, uidNext: Math.max(0, ...messages.map((m) => m.uid)) + 1 };
        return Promise.resolve({ release: () => { released++; } });
      },
      search(query: { uid: string }, options: unknown) {
        assertEquals(options, { uid: true });
        searches++;
        const [first, last] = query.uid.split(":").map(Number);
        return Promise.resolve(messages.filter((m) => m.uid >= first && m.uid <= last).map((m) => m.uid).reverse());
      },
      fetchAll(uids: number[], query: unknown, options: unknown) {
        assertEquals(query, { uid: true, source: true });
        assertEquals(options, { uid: true });
        fetched = uids;
        return Promise.resolve(messages.filter((m) => uids.includes(m.uid)).reverse());
      },
      messageFlagsAdd() { throw new Error("Mailbox flags must stay unchanged"); },
    });
    try {
      assertEquals(await receive(app, { probe: true }), 0);
      assertEquals(await db.one`SELECT COUNT(*) FROM email_inbox`, 0);
      assertEquals(await receive(app, { limit: 1 }), 1);
      assertEquals(fetched, [2]);
      assertEquals(await db.one`SELECT uid FROM email_inbox`, 2);
      assertEquals(await receive(app), 1);
      assertEquals(fetched, [5]);
      assertEquals(await db.one`SELECT COUNT(*) FROM message`, 2);
      assertEquals(await db.one`SELECT COUNT(*) FROM email_import`, 2);
      const before = searches;
      assertEquals(await receive(app), 0);
      assertEquals(searches, before, "no search or fetch when the cursor is current");

      await db.exec`DELETE FROM message_delivery`;
      await db.exec`DELETE FROM message`;
      validity++;
      messages = messages.map((m, i) => ({ ...m, uid: i + 1 }));
      assertEquals(await receive(app), 2);
      assertEquals(await db.one`SELECT COUNT(*) FROM message`, 0, "deleted mails stay deleted after UIDVALIDITY changes, including mail without Message-ID");
      assertEquals(await db.one`SELECT COUNT(*) FROM email_import`, 2);

      messages.push({ uid: 3, source: source("new") }, { uid: 4, source: source("later") });
      await db.exec`CREATE TRIGGER fail_receipt BEFORE INSERT ON email_import BEGIN SELECT RAISE(ABORT, 'receipt failed'); END`;
      const error = console.error;
      console.error = () => {};
      try { assertEquals(await receive(app), 0); } finally { console.error = error; }
      assertEquals(await db.one`SELECT uid FROM email_inbox`, 2, "failed receipt must not advance the cursor");
      assertEquals(await db.one`SELECT COUNT(*) FROM message`, 0, "journal and receipt roll back together");
      await db.exec`DROP TRIGGER fail_receipt`;
      assertEquals(await receive(app), 2);
      assertEquals(await db.one`SELECT COUNT(*) FROM message`, 2);
      assertEquals(await db.one`SELECT uid FROM email_inbox`, 4);
      assertEquals(released, closed);
    } finally {
      for (const key of Object.keys(prototype)) if (!originals[key]) delete prototype[key];
      Object.defineProperties(prototype, originals);
      await db.close();
    }
  },
});
