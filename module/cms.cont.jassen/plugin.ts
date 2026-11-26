import { Access, ApiError, html, Output, s } from "@qino/qino";

import { DECK_IDS, DECKS, isDeckId } from "./decks.ts";
import { hub } from "./hub.ts";

import type { ApiTree, Ctx } from "@qino/qino";
import type { Node } from "@qino/qino/cms";
import type { DeckId, GameMode } from "./decks.ts";

const NAME = "cms.cont.jassen";
const KEEPALIVE_MS = 25000;

const settingsSchema = {
  properties: {
    deck: {
      type: "string",
      enum: DECK_IDS,
      default: "swiss36",
      description: "Default card deck for new tables.",
    },
    mode: {
      type: "string",
      enum: ["jass", "tschau", "free"],
      default: "jass",
      description: "Default game mode: jass (Swiss Jass tricks & trump), tschau (Tschau Sepp), or free (draw & discard pile).",
    },
    radius: {
      type: "integer",
      minimum: 100,
      maximum: 50000,
      default: 2000,
      description: "Nearby discovery radius in meters when players share their position.",
    },
    showCounts: {
      type: "boolean",
      default: true,
      description: "Show how many cards other players currently hold.",
    },
  },
};

/** Anonymous per-session player identity, created on demand without requiring an account. */
async function playerOf(ctx: Ctx, nameOverride?: string): Promise<{ id: string; name: string }> {
  const store = ctx.sess.data[NAME];
  let id = store.id() as string | undefined;
  if (!id) {
    id = `p_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
    await store.id(id);
  }
  let name = (store.name() as string | undefined) ?? "";
  if (nameOverride !== undefined) {
    const clean = nameOverride.trim().slice(0, 24);
    if (clean !== name) {
      name = clean;
      await store.name(clean);
    }
  }
  return { id, name };
}

export const api: ApiTree = {
  action: {
    post: {
      description: "Run a card table action (create, join, nearby, deal, play, draw, etc.) as an anonymous session player.",
      access: Access.PUBLIC,
      input: s.object({
        op: s.string(),
        nodeId: s.optional(s.number()),
        code: s.optional(s.string()),
        name: s.optional(s.string()),
        tableName: s.optional(s.string()),
        deck: s.optional(s.string()),
        mode: s.optional(s.string()),
        trump: s.optional(s.string()),
        dealCount: s.optional(s.number()),
        cardId: s.optional(s.string()),
        wishSuit: s.optional(s.string()),
        lat: s.optional(s.number()),
        lon: s.optional(s.number()),
        radius: s.optional(s.number()),
      }),
      execute: async (raw, ctx: Ctx) => {
        const input = raw as {
          op: string; nodeId?: number; code?: string; name?: string; tableName?: string;
          deck?: string; mode?: string; trump?: string; dealCount?: number; cardId?: string;
          wishSuit?: string; lat?: number; lon?: number; radius?: number;
        };
        const tables = hub(ctx.app);
        const nodeId = Number(input.nodeId ?? 0);
        const player = await playerOf(ctx, input.name);

        switch (input.op) {
          case "nearby":
            return {
              player,
              tables: tables.nearby(nodeId, { lat: input.lat, lon: input.lon, radius: input.radius }),
            };
          case "create":
            return {
              player,
              table: tables.create(nodeId, player, {
                name: input.tableName,
                deck: isDeckId(input.deck) ? input.deck : undefined,
                mode: input.mode === "free" || input.mode === "tschau" ? input.mode : "jass",
                lat: input.lat,
                lon: input.lon,
              }),
            };
          case "join":
            return {
              player,
              table: tables.join(String(input.code ?? ""), player, { lat: input.lat, lon: input.lon }),
            };
          case "leave":
            return tables.leave(String(input.code ?? ""), player.id);
          case "state":
            return { player, table: tables.state(String(input.code ?? ""), player.id) };
          case "rename":
            return { player, table: tables.rename(String(input.code ?? ""), player.id, String(input.name ?? "")) };
          case "location":
            return {
              player,
              table: tables.shareLocation(String(input.code ?? ""), player.id, Number(input.lat), Number(input.lon)),
            };
          case "addBot":
            return { player, table: tables.addBot(String(input.code ?? ""), player.id) };
          case "removeBots":
            return { player, table: tables.removeBots(String(input.code ?? ""), player.id) };
          case "quickStart":
            return { player, table: tables.quickStart(String(input.code ?? ""), player.id) };
          case "configure":
            return {
              player,
              table: tables.configure(String(input.code ?? ""), player.id, {
                deck: isDeckId(input.deck) ? input.deck : undefined,
                mode: input.mode === "jass" || input.mode === "tschau" || input.mode === "free" ? input.mode : undefined,
                trump: input.trump,
                dealCount: input.dealCount,
                name: input.tableName,
              }),
            };
          case "deal":
            return {
              player,
              table: tables.deal(String(input.code ?? ""), player.id, {
                dealCount: input.dealCount,
                trump: input.trump,
              }),
            };
          case "play":
            return {
              player,
              table: tables.play(String(input.code ?? ""), player.id, String(input.cardId ?? ""), {
                wishSuit: input.wishSuit,
              }),
            };
          case "draw":
            return { player, table: tables.draw(String(input.code ?? ""), player.id) };
          case "takePile":
            return { player, table: tables.takePile(String(input.code ?? ""), player.id) };
          case "clearPile":
            return { player, table: tables.clearPile(String(input.code ?? ""), player.id) };
          default:
            throw new ApiError(400, `Unknown operation: ${input.op}`);
        }
      },
    },
  },
  stream: {
    get: {
      description: "Live table updates as Server-Sent Events for the current anonymous session player.",
      access: Access.PUBLIC,
      query: s.object({ code: s.string() }),
      execute: async ({ code }: { code: string }, ctx: Ctx) => {
        const player = await playerOf(ctx);
        const tables = hub(ctx.app);
        // Verify table exists before opening stream so 404 returns cleanly.
        tables.state(code, player.id);

        const encoder = new TextEncoder();
        let unsubscribe: (() => void) | null = null;
        let timer: ReturnType<typeof setInterval> | null = null;

        throw new Output(
          new ReadableStream({
            start(out) {
              const send = (chunk: string) => {
                try { out.enqueue(encoder.encode(chunk)); } catch { cleanup(); }
              };
              const cleanup = () => {
                if (timer) { clearInterval(timer); timer = null; }
                if (unsubscribe) { unsubscribe(); unsubscribe = null; }
              };
              unsubscribe = tables.subscribe(code, player.id, (view) => {
                send(`data: ${JSON.stringify(view)}\n\n`);
              });
              timer = setInterval(() => send(": ping\n\n"), KEEPALIVE_MS);
            },
            cancel() {
              if (timer) { clearInterval(timer); timer = null; }
              if (unsubscribe) { unsubscribe(); unsubscribe = null; }
            },
          }),
          {
            headers: {
              "content-type": "text/event-stream; charset=utf-8",
              "cache-control": "no-cache, no-store",
              "x-accel-buffering": "no",
            },
          },
        );
      },
    },
  },
};

async function render(node: Node, { ctx }: { ctx: Ctx }) {
  const t = node.app.t.in(NAME);
  const rawDeck = node.settings.deck();
  const deck: DeckId = isDeckId(rawDeck) ? rawDeck : "swiss36";
  const rawMode = node.settings.mode();
  const mode: GameMode = rawMode === "free" || rawMode === "tschau" ? rawMode : "jass";
  const radius = Math.min(Math.max(Number(node.settings.radius() ?? 2000), 100), 50000);
  const showCounts = node.settings.showCounts() !== false;
  const savedName = String(ctx.sess.data[NAME].name() ?? "");
  const joinCode = String(ctx.req.query.jass ?? "").trim().toUpperCase().slice(0, 6);

  const deckOptions = DECK_IDS.map((id) =>
    html`<option value=${id} ${id === deck ? html.raw("selected") : ""}>${DECKS[id].name}</option>`
  );

  return html.async`<div class=cms-jassen
    data-node-id=${node.id}
    data-deck=${deck}
    data-mode=${mode}
    data-radius=${radius}
    data-show-counts=${showCounts ? "1" : "0"}
    data-join-code="${joinCode}">

    <section class=-lobby aria-label="${t`Card table lobby`}">
      <header class=-head>
        <h2>${t`Jassen & Card Table`}</h2>
        <p class=-sub>${t`Play anonymously with friends nearby — no account needed.`}</p>
      </header>

      <div class=-row>
        <label class=-field>
          <span>${t`Pseudonym (optional)`}</span>
          <input type=text class=-name maxlength=24 placeholder="${t`e.g. Sepp`}" value="${savedName}" autocomplete=nickname>
        </label>
        <label class=-field>
          <span>${t`Card deck`}</span>
          <select class=-deck-pick>${deckOptions}</select>
        </label>
        <label class=-field>
          <span>${t`Game mode`}</span>
          <select class=-mode-pick>
            <option value=jass ${mode === "jass" ? html.raw("selected") : ""}>${t`Jassen (Schieber / Tricks)`}</option>
            <option value=tschau ${mode === "tschau" ? html.raw("selected") : ""}>${t`Tschau Sepp`}</option>
            <option value=free ${mode === "free" ? html.raw("selected") : ""}>${t`Free card table (Draw & Pile)`}</option>
          </select>
        </label>
      </div>

      <div class=-actions>
        <button type=button class=-create>${t`New table`}</button>
        <button type=button class=-nearby>${t`Find nearby tables`}</button>
      </div>

      <form class=-join-form>
        <input type=text class=-code-input maxlength=6 placeholder="${t`Table code`}" value="${joinCode}" aria-label="${t`Table code`}" autocapitalize=characters spellcheck=false>
        <button type=submit>${t`Join`}</button>
      </form>

      <div class=-nearby-box hidden>
        <h3>${t`Tables nearby`}</h3>
        <ul class=-nearby-list></ul>
      </div>

      <p class=-status role=status aria-live=polite></p>
    </section>

    <section class=-stage hidden aria-label="${t`Card table`}">
      <div class=-topbar>
        <div class=-info>
          <button type=button class=-table-code title="${t`Copy invite link`}"><span class=-code-val></span><svg class=-ico viewBox="0 0 24 24" aria-hidden=true><rect x=9 y=9 width=13 height=13 rx=2/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button>
          <button type=button class=-pin title="${t`Share location so friends nearby can join`}"><svg class=-ico viewBox="0 0 24 24" aria-hidden=true><path d="M12 21s-6-5.3-6-10a6 6 0 1 1 12 0c0 4.7-6 10-6 10Z"/><circle cx=12 cy=11 r=2.5/></svg><span class=-pin-label>${t`Nearby`}</span></button>
          <button type=button class=-trump-btn hidden>${t`Trump`}</button>
        </div>
        <div class=-tools>
          <button type=button class=-fullscreen title="${t`Fullscreen`}"><svg class=-ico viewBox="0 0 24 24" aria-hidden=true><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg><span>${t`Fullscreen`}</span></button>
          <button type=button class=-leave title="${t`Leave table`}"><svg class=-ico viewBox="0 0 24 24" aria-hidden=true><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></svg><span>${t`Leave`}</span></button>
        </div>
      </div>

      <div class=-canvas-wrap>
        <canvas class=-canvas></canvas>
        <div class=-overlay hidden>
          <strong class=-overlay-title></strong>
          <ul class=-overlay-players></ul>
          <div class=-overlay-actions>
            <button type=button class=-quick-start>${t`Start 4-player Jass with bots`}</button>
            <button type=button class=-overlay-deal>${t`Deal cards`}</button>
            <button type=button class=-overlay-share>${t`Share link`}</button>
            <button type=button class=-overlay-pin>${t`Share location`}</button>
          </div>
        </div>
        <div class=-toast role=status aria-live=polite hidden></div>
      </div>

      <dialog class=-trump-dialog>
        <h3>${t`Choose trump`}</h3>
        <div class=-trump-grid></div>
        <form method=dialog><button class=-dialog-close>${t`Cancel`}</button></form>
      </dialog>
    </section>
  </div>`;
}

export const cms = {
  node: {
    render,
    settingsSchema,
    css: ["pub/main.css"],
    js: ["pub/main.js"],
  },
};
