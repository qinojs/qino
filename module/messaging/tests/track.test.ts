import { assertEquals, assertThrows } from "@std/assert";
import { Output } from "@qino/qino";

import { markers, PIXEL, trackHits } from "../lib/track.ts";
import { renderer } from "../mod.ts";
import { testApp as app } from "./deps.ts";

import type { App } from "@qino/qino";

Deno.test("every recipient gets their own marker, and a made-up one is not one of ours", async () => {
  const a = await app();
  const links = [{ url: "https://qino.test/s/c1", kind: "click" as const }, { url: "https://qino.test/s/c2", kind: "load" as const }];
  const mark = await markers(a, links)(42);
  const text = mark("go https://qino.test/s/c1 and see https://qino.test/s/c2");
  const [, click, load] = text.match(/s\/c1\/(\S+) and see .*s\/c2\/(\S+)/)!;
  assertEquals(click.slice(0, 2), "16"); // 42 in base36, then the kind
  assertEquals(click[2], "c");
  assertEquals(load.slice(0, 3), "16l");
  assertEquals(click.length, 6); // id, kind, three signing characters

  const other = await markers(a, links)(43);
  assertEquals(other(links[0].url).endsWith(click), false); // walking 1, 2, 3 does not produce the next marker
  await a.db.close();
});

Deno.test("the template's links are shortened with the message's own, and both carry the marker", async () => {
  const a = await app();
  await a.db.table("message_template").insert({
    name: "letter", channel: "email", main: true, format: "md",
    text: "{{content}}\n\n[abmelden](/unsubscribe)",
  });
  const render = await renderer(a, { text: "[shop](/shop)", format: "md" }, "email");
  const plain = (await render({ deliveryId: 7 })).text;
  const marker = plain.match(/s\/c1\/(\S+)/)![1];
  assertEquals(plain, `shop: https://qino.test/s/c1/${marker}\n\nabmelden: https://qino.test/s/c2/${marker}`);
  const untracked = (await render()).text; // no delivery, no marker — merely short
  assertEquals(untracked, "shop: https://qino.test/s/c1\n\nabmelden: https://qino.test/s/c2");
  await a.db.close();
});

Deno.test("a hit writes who reached which address; a tag this key cannot read is not ours", async () => {
  const a = await app();
  await a.db.table("message").insert({ channel: "email", direction: "out", data: "null", time: 1 });
  await a.db.table("message_delivery").insert({ message_id: 1, address: "one@qino.test", time: 1 });
  // deno-lint-ignore no-explicit-any
  const handlers = new Map<string, (e: any) => Promise<void>>();
  const emitter = {
    ...a,
    // deno-lint-ignore no-explicit-any
    on: (name: string, fn: (e: any) => Promise<void>) => handlers.set(name, fn),
  } as unknown as App;
  trackHits(emitter, new AbortController().signal);
  const hit = handlers.get("shorturl:hit")!;

  const marker = (await markers(a, [{ url: "u", kind: "load" }])(1))("u").slice(2);
  await hit({ link: { code: "c1" }, tag: marker });
  await hit({ link: { code: "c1" }, tag: "1lXXX" }); // the id is real, the signature is not
  await hit({ link: { code: "c1" }, tag: "campaign-7" }); // another module's tag, not a broken marker
  await new Promise((r) => setTimeout(r, 10)); // the insert never delays the redirect

  assertEquals(await a.db.query`SELECT delivery_id, code, kind FROM message_track`, [{ delivery_id: 1, code: "c1", kind: "load" }]);
  await a.db.close();
});

Deno.test("html carries an open beacon, plain text and telegram do not", async () => {
  const a = await app();
  const mail = await renderer(a, { text: "**hi**", format: "md" }, "email");
  const html = (await mail({ deliveryId: 3 })).html ?? "";
  const beacon = html.match(/<img src="([^"]+)" width="1"/)?.[1] ?? "";
  assertEquals(/\/3l\S{3}$/.test(beacon), true); // delivery 3, marked as a load like any image
  assertEquals((await mail({ deliveryId: 3 })).text.includes(beacon), false); // no page, no beacon

  const chat = await renderer(a, { text: "**hi**", format: "md" }, "telegram", "telegram");
  assertEquals((await chat({ deliveryId: 3 })).html?.includes("<img"), false);
  await a.db.close();
});

Deno.test("the beacon answers with a transparent gif nobody caches", async () => {
  const a = await app();
  // deno-lint-ignore no-explicit-any
  const handlers = new Map<string, (e: any) => unknown>();
  // deno-lint-ignore no-explicit-any
  trackHits({ ...a, on: (name: string, fn: (e: any) => unknown) => handlers.set(name, fn) } as unknown as App, new AbortController().signal);
  const route = handlers.get("route")!;

  assertEquals(route({ ctx: { req: { appPath: "somewhere/else" } } }), undefined);
  const out = assertThrows(() => route({ ctx: { req: { appPath: PIXEL } } }), Output);
  const headers = new Headers(out.headers);
  assertEquals(headers.get("Content-Type"), "image/gif");
  assertEquals(headers.get("Cache-Control"), "no-store");
  await a.db.close();
});
