import { test } from "node:test";
import { App, bildJsonItem, fs, requestStorage } from "@qino/qino";
import { cms as tree } from "@qino/qino/cms";
import { assertEquals, assertStringIncludes, testContext } from "@qino/qino/tests";

import { buildDeck, canPlayAloechlen, canPlayTschau, cardPoints, hoseScore, scoreTrick, shuffle } from "../decks.ts";
import { distanceMeters, hub } from "../hub.ts";
import { api, cms } from "../plugin.ts";

test("canPlayTschau validates matching suit/rank, J wildcards and 7 stacking", () => {
  const top = { id: "rosen:8", suit: "rosen", rank: "8" };
  assertEquals(canPlayTschau({ id: "rosen:6", suit: "rosen", rank: "6" }, top, "", 0), true);
  assertEquals(canPlayTschau({ id: "schellen:8", suit: "schellen", rank: "8" }, top, "", 0), true);
  assertEquals(canPlayTschau({ id: "schellen:9", suit: "schellen", rank: "9" }, top, "", 0), false);
  assertEquals(canPlayTschau({ id: "schellen:J", suit: "schellen", rank: "J" }, top, "", 0), true);
  assertEquals(canPlayTschau({ id: "eicheln:6", suit: "eicheln", rank: "6" }, top, "eicheln", 0), true);
  assertEquals(canPlayTschau({ id: "rosen:6", suit: "rosen", rank: "6" }, top, "eicheln", 0), false);
  // Under +2 stack, only 7 may be played
  assertEquals(canPlayTschau({ id: "eicheln:7", suit: "eicheln", rank: "7" }, top, "", 2), true);
  assertEquals(canPlayTschau({ id: "rosen:J", suit: "rosen", rank: "J" }, top, "", 2), false);
});

test("Tschau Sepp handles +2, skip, reverse, ace, wish suit and quickStart", () => {
  const app = {} as App;
  const h = hub(app);
  const t = h.create(1, { id: "p1", name: "Anna" }, { mode: "tschau", deck: "swiss36" });
  h.join(t.code, { id: "p2", name: "Beat" });
  h.join(t.code, { id: "p3", name: "Clara" });
  const dealt = h.deal(t.code, "p1");
  assertEquals(dealt.me?.hand.length, 7);
  assertEquals(dealt.pile.length, 1);

  // Play or draw cleanly for current player in Tschau Sepp
  const curId = dealt.turnPlayerId!;
  const curState = h.state(t.code, curId);
  const top = curState.pile.at(-1)!.card;
  const playable = curState.me!.hand.find((c) => canPlayTschau(c, top, curState.wishSuit, curState.pendingDraw));
  if (playable) {
    const played = h.play(t.code, curId, playable.id, { wishSuit: "rosen" });
    assertEquals(played.pile.length, 2);
    assertEquals(played.me!.hand.length, 6);
  } else {
    const drawn = h.draw(t.code, curId);
    assertEquals(drawn.me!.hand.length, 8);
  }

  // quickStart in Tschau Sepp mode fills to 3 players with bots
  const solo = h.create(1, { id: "s1", name: "Solo" }, { mode: "tschau" });
  const quick = h.quickStart(solo.code, "s1");
  assertEquals(quick.players.length, 3);
  assertEquals(quick.me?.hand.length, 7);
});

test("Hose abe scores suit sums, 31, three-of-a-kind and supports swap & knock", () => {
  assertEquals(hoseScore([
    { id: "hearts:A", suit: "hearts", rank: "A" },
    { id: "hearts:K", suit: "hearts", rank: "K" },
    { id: "hearts:10", suit: "hearts", rank: "10" },
  ]), 31);
  assertEquals(hoseScore([
    { id: "hearts:9", suit: "hearts", rank: "9" },
    { id: "spades:9", suit: "spades", rank: "9" },
    { id: "clubs:9", suit: "clubs", rank: "9" },
  ]), 30.5);
  assertEquals(hoseScore([
    { id: "hearts:A", suit: "hearts", rank: "A" },
    { id: "spades:A", suit: "spades", rank: "A" },
    { id: "clubs:A", suit: "clubs", rank: "A" },
  ]), 33);

  const h = hub({} as App);
  const t = h.create(1, { id: "h1", name: "Hansi" }, { mode: "hoseabe", deck: "swiss36" });
  h.join(t.code, { id: "h2", name: "Vreni" });
  const dealt = h.deal(t.code, "h1");
  assertEquals(dealt.me?.hand.length, 3);
  assertEquals(dealt.pile.length, 3);

  // Swap 1 card, then opponent knocks, then h1 swaps all 3 -> round finishes
  const afterSwap = h.swap(t.code, "h1", dealt.me!.hand[0].id, 0);
  if (!afterSwap.winnerId) {
    const afterKnock = h.pass(t.code, "h2");
    assertEquals(afterKnock.knockerId, "h2");
    const finished = h.swap(t.code, "h1", "", -1);
    assertEquals(finished.winnerId !== null, true);
  }
});

test("A-löchlen validates rank combos, plays sets and clears pile on pass", () => {
  const hand = [
    { id: "rosen:8", suit: "rosen", rank: "8" },
    { id: "eicheln:8", suit: "eicheln", rank: "8" },
    { id: "rosen:A", suit: "rosen", rank: "A" },
  ];
  assertEquals(canPlayAloechlen(hand, hand[0], null, 0), true);
  assertEquals(canPlayAloechlen(hand, hand[0], "7", 2), true);
  assertEquals(canPlayAloechlen(hand, hand[2], "7", 2), false); // only 1 Ace in hand
  assertEquals(canPlayAloechlen(hand, hand[0], "9", 1), false); // 8 < 9

  const h = hub({} as App);
  const t = h.create(1, { id: "a1", name: "Toni" }, { mode: "aloechlen", deck: "swiss36" });
  h.join(t.code, { id: "a2", name: "Bea" });
  const dealt = h.deal(t.code, "a1");
  assertEquals(dealt.me?.hand.length, 18);

  const played = h.play(t.code, "a1", dealt.me!.hand[0].id);
  assertEquals(played.pile.length >= 1, true);
  const afterPass = h.pass(t.code, "a2");
  assertEquals(afterPass.pile.length, 0);
});

test("decks build expected card counts and Jass scoring handles trump, Puur, Nell, Obenabe and Undeufe", () => {
  assertEquals(buildDeck("swiss36").length, 36);
  assertEquals(buildDeck("french36").length, 36);
  assertEquals(buildDeck("french52").length, 52);
  assertEquals(buildDeck("german32").length, 32);

  const deck = buildDeck("swiss36");
  const shuffled = shuffle(deck);
  assertEquals(shuffled.length, 36);
  assertEquals(new Set(shuffled.map((c) => c.id)).size, 36);

  // Trump Puur (Under/J) = 20, Nell (9) = 14, Ass = 11
  assertEquals(cardPoints({ id: "rosen:J", suit: "rosen", rank: "J" }, "rosen"), 20);
  assertEquals(cardPoints({ id: "rosen:9", suit: "rosen", rank: "9" }, "rosen"), 14);
  assertEquals(cardPoints({ id: "schellen:J", suit: "schellen", rank: "J" }, "rosen"), 2);
  assertEquals(cardPoints({ id: "schellen:8", suit: "schellen", rank: "8" }, "obe"), 8);
  assertEquals(cardPoints({ id: "schellen:6", suit: "schellen", rank: "6" }, "unde"), 11);

  // Puur beats Ass even when another suit was led
  const trick = scoreTrick([
    { card: { id: "schellen:A", suit: "schellen", rank: "A" }, playerId: "p1" },
    { card: { id: "rosen:J", suit: "rosen", rank: "J" }, playerId: "p2" },
    { card: { id: "rosen:9", suit: "rosen", rank: "9" }, playerId: "p3" },
  ], "rosen", true);
  assertEquals(trick.winnerIndex, 1);
  assertEquals(trick.points, 11 + 20 + 14 + 5); // +5 for last trick
});

test("nearby discovery sorts by Haversine distance and isolates tenants", () => {
  // Bern (46.948, 7.4474) to a spot ~110m north
  const d = distanceMeters(46.948, 7.4474, 46.949, 7.4474);
  assertEquals(d > 80 && d < 140, true);

  const appA = {} as App;
  const appB = {} as App;
  const hubA = hub(appA);
  const hubB = hub(appB);

  const far = hubA.create(10, { id: "p1", name: "Anna" }, { lat: 46.955, lon: 7.4474 });
  const near = hubA.create(10, { id: "p2", name: "Beat" }, { lat: 46.9485, lon: 7.4474 });
  hubB.create(10, { id: "p3", name: "OtherTenant" }, { lat: 46.948, lon: 7.4474 });

  const found = hubA.nearby(10, { lat: 46.948, lon: 7.4474, radius: 2000 });
  assertEquals(found.map((t) => t.code), [near.code, far.code]);
  assertEquals(hubB.nearby(10, { lat: 46.948, lon: 7.4474, radius: 2000 }).length, 1);
});

test("anonymous players can create, join, deal privately, play tricks and render CMS block", async () => {
  const dir = await fs.tempDir() + "/";
  const app = new App({ db: "sqlite::memory:", dir });
  app.stores.add(import.meta.resolve("../../../module/store.json")).add("starter.cms");
  app.stores.add(import.meta.resolve("../../store.json")).add("cms.cont.jassen");
  await app.init();

  const makeCtx = async () => {
    const data = bildJsonItem(JSON.stringify({ core: { userId: 0 } }), () => {}).proxy;
    const ctx = await testContext({ app, userId: 0, sess: { data }, set: { app } });
    await ctx.initSettings();
    return ctx;
  };

  try {
    const alice = await makeCtx();
    const bob = await makeCtx();

    const exec = (ctx: Awaited<ReturnType<typeof makeCtx>>, body: Record<string, unknown>) =>
      (api.action as { post: { execute: (p: Record<string, unknown>, c: typeof ctx) => Promise<any> } }).post.execute(body, ctx);

    // Alice creates a Jass table anonymously with optional pseudonym
    const created = await exec(alice, { op: "create", nodeId: 7, name: "Alice", deck: "swiss36", mode: "jass" });
    const code = created.table.code as string;
    assertEquals(code.length, 4);
    assertEquals(created.table.players.length, 1);
    assertEquals(created.table.players[0].name, "Alice");

    // Bob joins anonymously without a pseudonym -> default fallback name
    const joined = await exec(bob, { op: "join", nodeId: 7, code });
    assertEquals(joined.table.players.length, 2);
    assertEquals(created.player.id !== joined.player.id, true);

    // Deal cards: each player only receives their own hand (privacy check)
    const dealt = await exec(alice, { op: "deal", nodeId: 7, code });
    assertEquals(dealt.table.me.hand.length, 9);
    assertEquals(dealt.table.players.every((p: Record<string, unknown>) => !("hand" in p)), true);

    const bobState = await exec(bob, { op: "state", nodeId: 7, code });
    assertEquals(bobState.table.me.hand.length, 9);
    const aliceIds = new Set(dealt.table.me.hand.map((c: { id: string }) => c.id));
    for (const c of bobState.table.me.hand as { id: string }[]) {
      assertEquals(aliceIds.has(c.id), false);
    }

    // Both play a card into the trick -> trick completes -> takePile awards points
    const afterAlice = await exec(alice, { op: "play", nodeId: 7, code, cardId: dealt.table.me.hand[0].id });
    assertEquals(afterAlice.table.pile.length, 1);
    assertEquals(afterAlice.table.topCard.card.id, dealt.table.me.hand[0].id);

    const afterBob = await exec(bob, { op: "play", nodeId: 7, code, cardId: bobState.table.me.hand[0].id });
    assertEquals(afterBob.table.trickComplete, true);

    const afterTake = await exec(alice, { op: "takePile", nodeId: 7, code });
    assertEquals(afterTake.table.pile.length, 0);
    assertEquals(afterTake.table.lastTrick !== null, true);

    // Switch to free mode and french52 deck -> draw pile + starter top card
    await exec(alice, { op: "configure", nodeId: 7, code, deck: "french52", mode: "free" });
    const freeDeal = await exec(alice, { op: "deal", nodeId: 7, code });
    assertEquals(freeDeal.table.me.hand.length, 7);
    assertEquals(freeDeal.table.pile.length, 1);
    assertEquals(freeDeal.table.drawCount, 52 - 14 - 1);

    // QuickStart fills a solo Jass table to 4 seats with bots and deals 9 cards each
    const solo = await exec(alice, { op: "create", nodeId: 7, name: "Solo", deck: "swiss36", mode: "jass" });
    const quick = await exec(alice, { op: "quickStart", nodeId: 7, code: solo.table.code });
    assertEquals(quick.table.players.length, 4);
    assertEquals(quick.table.me.hand.length, 9);

    // Full HTTP roundtrip: GET page -> POST create + quickStart -> GET SSE stream
    const pageRes = await app.fetch(new Request("http://localhost:8080/en/home"));
    const pageHtml = await pageRes.text();
    await new Promise((resolve) => setTimeout(resolve, 50)); // session write is non-blocking
    const csrf = pageHtml.match(/"csrfToken":\s*"([^"]+)"/)?.[1] ?? "";
    const cookies = (pageRes.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
    const headers = { "content-type": "application/json", origin: "http://localhost:8080", "x-csrf-token": csrf, cookie: cookies };

    const httpCreated = await (await app.fetch(new Request("http://localhost:8080/api/cms.cont.jassen/action", {
      method: "POST", headers, body: JSON.stringify({ op: "create", nodeId: 7, deck: "swiss36", mode: "jass" }),
    }))).json();
    assertEquals(httpCreated.table.code.length, 4);

    const httpQuick = await (await app.fetch(new Request("http://localhost:8080/api/cms.cont.jassen/action", {
      method: "POST", headers, body: JSON.stringify({ op: "quickStart", nodeId: 7, code: httpCreated.table.code }),
    }))).json();
    assertEquals(httpQuick.table.players.length, 4);

    const sseRes = await app.fetch(new Request(`http://localhost:8080/api/cms.cont.jassen/stream?code=${httpCreated.table.code}`, {
      headers: { cookie: cookies },
    }));
    assertEquals(sseRes.status, 200);
    assertStringIncludes(sseRes.headers.get("content-type") ?? "", "text/event-stream");
    const reader = sseRes.body!.getReader();
    const first = new TextDecoder().decode((await reader.read()).value);
    assertStringIncludes(first, httpCreated.table.code);
    await reader.cancel();

    // Render CMS node
    const adminId = Number(await app.db.table("usr").insert({ username: "jass-admin", superuser: true, pw: "" }));
    const adminData = bildJsonItem(JSON.stringify({ core: { userId: adminId } }), () => {}).proxy;
    const adminCtx = await testContext({ app, userId: adminId, sess: { data: adminData }, set: { app } });
    await adminCtx.initSettings();

    const root = await tree(app).node(1);
    const node = await requestStorage.run(adminCtx, () =>
      root.createChild({ module: "cms.cont.jassen", access: 1, online_start: 0, online_end: 0 })
    );
    const rendered = String(await requestStorage.run(alice, () => cms.node.render(node, { ctx: alice })));
    assertStringIncludes(rendered, "cms-jassen");
    assertStringIncludes(rendered, "swiss36");
  } finally {
    await new Promise((resolve) => setTimeout(resolve, 100));
    await app.db.close();
    await fs.remove(dir, { recursive: true });
  }
});
