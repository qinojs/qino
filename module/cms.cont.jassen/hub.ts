import { ApiError } from "@qino/qino";

import { buildDeck, canPlayAloechlen, canPlayTschau, DECKS, hoseScore, isDeckId, rankOrder, scoreTrick, shuffle, sortHand } from "./decks.ts";

import type { App } from "@qino/qino";
import type { Card, DeckId, GameMode, Trump } from "./decks.ts";

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const IDLE_TTL_MS = 2 * 60 * 60 * 1000;
const MAX_PLAYERS = 6;
const MAX_NAME = 24;

type Seat = {
  id: string;
  name: string;
  hand: Card[];
  tricks: number;
  points: number;
  lives: number;
  isBot: boolean;
  lastSeen: number;
};

type PileCard = {
  card: Card;
  playerId: string;
  playerName: string;
  x: number;
  y: number;
  rot: number;
};

type LastTrick = {
  winnerId: string;
  winnerName: string;
  points: number;
  cards: Card[];
};

type Listener = (view: ReturnType<typeof tableView>) => void;

type Table = {
  code: string;
  nodeId: number;
  name: string;
  deck: DeckId;
  mode: GameMode;
  dealCount: number;
  trump: Trump;
  direction: 1 | -1;
  pendingDraw: number;
  wishSuit: string;
  winnerId: string | null;
  banner: string;
  comboCount: number;
  lastPlayerId: string | null;
  passedIds: string[];
  finishOrder: string[];
  prevFinishOrder: string[];
  knockerId: string | null;
  location: { lat: number; lon: number; updated: number } | null;
  players: Seat[];
  drawPile: Card[];
  pile: PileCard[];
  lastTrick: LastTrick | null;
  turn: number;
  round: number;
  trickComplete: boolean;
  version: number;
  updated: number;
  listeners: Map<string, Set<Listener>>;
};

const hubs = new WeakMap<App, JassHub>();

/** Per-App hub so tenants never share tables. */
export function hub(app: App): JassHub {
  let instance = hubs.get(app);
  if (!instance) {
    instance = new JassHub();
    hubs.set(app, instance);
  }
  return instance;
}

/** Haversine distance in meters between two WGS84 coordinates. */
export function distanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * 6371000 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function cleanName(name: unknown, fallback: string): string {
  const s = String(name ?? "").trim().replace(/\s+/g, " ").slice(0, MAX_NAME);
  return s || fallback;
}

function validCoords(lat: unknown, lon: unknown): { lat: number; lon: number } | null {
  const la = Number(lat), lo = Number(lon);
  if (!Number.isFinite(la) || !Number.isFinite(lo)) return null;
  if (la < -90 || la > 90 || lo < -180 || lo > 180) return null;
  return { lat: la, lon: lo };
}

function makeCode(existing: Map<string, Table>): string {
  const bytes = new Uint8Array(6);
  for (let attempt = 0; attempt < 32; attempt++) {
    crypto.getRandomValues(bytes);
    let code = "";
    for (let i = 0; i < 4; i++) code += CODE_CHARS[bytes[i] % CODE_CHARS.length];
    if (!existing.has(code)) return code;
  }
  return String(Date.now()).slice(-6);
}

function jitter(seed: number) {
  const n = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return n - Math.floor(n);
}

function aloechlenRank(order: string[], id: string, total: number): string {
  const idx = order.indexOf(id);
  if (idx < 0) return "";
  if (idx === 0) return "Präsident";
  if (idx === total - 1) return "A-loch";
  if (total >= 4 && idx === 1) return "Vize";
  if (total >= 4 && idx === total - 2) return "Vize-A";
  return `Platz ${idx + 1}`;
}

function tableView(table: Table, playerId: string) {
  const me = table.players.find((p) => p.id === playerId);
  const myIndex = table.players.findIndex((p) => p.id === playerId);
  return {
    code: table.code,
    name: table.name,
    deck: table.deck,
    mode: table.mode,
    dealCount: table.dealCount,
    trump: table.trump,
    direction: table.direction,
    pendingDraw: table.pendingDraw,
    wishSuit: table.wishSuit,
    winnerId: table.winnerId,
    banner: table.banner,
    comboCount: table.comboCount,
    knockerId: table.knockerId,
    finishOrder: [...table.finishOrder],
    hasLocation: Boolean(table.location),
    round: table.round,
    turn: table.turn,
    turnPlayerId: table.players[table.turn]?.id ?? null,
    trickComplete: table.trickComplete,
    drawCount: table.drawPile.length,
    pile: [...table.pile],
    topCard: table.pile.at(-1) ?? null,
    lastTrick: table.lastTrick,
    version: table.version,
    me: me ? {
      id: me.id,
      name: me.name,
      seat: myIndex,
      hand: [...me.hand],
      hoseScore: table.mode === "hoseabe" ? hoseScore(me.hand) : 0,
    } : null,
    players: table.players.map((p, seat) => ({
      id: p.id,
      name: p.name,
      seat,
      cardCount: p.hand.length,
      tricks: p.tricks,
      points: p.points,
      lives: p.lives,
      rankLabel: table.mode === "aloechlen" ? aloechlenRank(table.finishOrder, p.id, table.players.length) : "",
      isBot: p.isBot,
    })),
  };
}

export class JassHub {
  #tables = new Map<string, Table>();

  #prune() {
    const cutoff = Date.now() - IDLE_TTL_MS;
    for (const [code, table] of this.#tables) {
      if (table.updated < cutoff && table.listeners.size === 0) this.#tables.delete(code);
    }
  }

  #get(code: string): Table {
    const key = String(code ?? "").trim().toUpperCase();
    const table = this.#tables.get(key);
    if (!table) throw new ApiError(404, "Table not found");
    return table;
  }

  #emit(table: Table) {
    table.version++;
    table.updated = Date.now();
    for (const [playerId, listeners] of table.listeners) {
      const view = tableView(table, playerId);
      for (const fn of listeners) fn(view);
    }
  }

  subscribe(code: string, playerId: string, fn: Listener): () => void {
    const table = this.#get(code);
    let set = table.listeners.get(playerId);
    if (!set) {
      set = new Set();
      table.listeners.set(playerId, set);
    }
    set.add(fn);
    fn(tableView(table, playerId));
    return () => {
      set.delete(fn);
      if (!set.size) table.listeners.delete(playerId);
    };
  }

  nearby(nodeId: number, opts: { lat?: number; lon?: number; radius?: number } = {}) {
    this.#prune();
    const coords = validCoords(opts.lat, opts.lon);
    const radius = Math.min(Math.max(Number(opts.radius) || 2000, 100), 50000);
    const results: {
      code: string;
      name: string;
      deck: DeckId;
      mode: GameMode;
      players: number;
      distance: number | null;
    }[] = [];

    for (const table of this.#tables.values()) {
      if (table.nodeId !== nodeId) continue;
      if (coords && table.location) {
        const dist = distanceMeters(coords.lat, coords.lon, table.location.lat, table.location.lon);
        if (dist <= radius) {
          results.push({
            code: table.code,
            name: table.name,
            deck: table.deck,
            mode: table.mode,
            players: table.players.length,
            distance: dist,
          });
        }
      } else if (!coords && table.location) {
        // Without client coordinates we never expose location-pinned tables
        continue;
      }
    }

    return results.sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity));
  }

  create(
    nodeId: number,
    player: { id: string; name?: string },
    opts: { name?: string; deck?: DeckId; mode?: GameMode; lat?: number; lon?: number } = {},
  ) {
    this.#prune();
    const code = makeCode(this.#tables);
    const deck: DeckId = isDeckId(opts.deck) ? opts.deck : "swiss36";
    const mode: GameMode = opts.mode === "free" || opts.mode === "tschau" || opts.mode === "aloechlen" || opts.mode === "hoseabe"
      ? opts.mode
      : "jass";
    const coords = validCoords(opts.lat, opts.lon);
    const now = Date.now();
    const table: Table = {
      code,
      nodeId,
      name: cleanName(opts.name, "Jasstisch"),
      deck,
      mode,
      dealCount: mode === "jass" ? 9 : 7,
      trump: "",
      direction: 1,
      pendingDraw: 0,
      wishSuit: "",
      winnerId: null,
      banner: "",
      comboCount: 0,
      lastPlayerId: null,
      passedIds: [],
      finishOrder: [],
      prevFinishOrder: [],
      knockerId: null,
      location: coords ? { ...coords, updated: now } : null,
      players: [{
        id: player.id,
        name: cleanName(player.name, "Spieler 1"),
        hand: [],
        tricks: 0,
        points: 0,
        lives: 3,
        isBot: false,
        lastSeen: now,
      }],
      drawPile: [],
      pile: [],
      lastTrick: null,
      turn: 0,
      round: 0,
      trickComplete: false,
      version: 1,
      updated: now,
      listeners: new Map(),
    };
    this.#tables.set(code, table);
    return tableView(table, player.id);
  }

  join(code: string, player: { id: string; name?: string }, opts: { lat?: number; lon?: number } = {}) {
    const table = this.#get(code);
    const now = Date.now();
    const existing = table.players.find((p) => p.id === player.id);
    if (existing) {
      if (player.name) existing.name = cleanName(player.name, existing.name);
      existing.lastSeen = now;
    } else {
      // Replace a bot seat first if the table has bots, otherwise append up to MAX_PLAYERS.
      const botIndex = table.players.findIndex((p) => p.isBot);
      if (botIndex >= 0 && table.round === 0) {
        table.players[botIndex] = {
          id: player.id,
          name: cleanName(player.name, `Spieler ${botIndex + 1}`),
          hand: [],
          tricks: 0,
          points: 0,
          lives: 3,
          isBot: false,
          lastSeen: now,
        };
      } else {
        if (table.players.length >= MAX_PLAYERS) throw new ApiError(409, "Table is full");
        table.players.push({
          id: player.id,
          name: cleanName(player.name, `Spieler ${table.players.length + 1}`),
          hand: [],
          tricks: 0,
          points: 0,
          lives: 3,
          isBot: false,
          lastSeen: now,
        });
      }
    }
    const coords = validCoords(opts.lat, opts.lon);
    if (coords && !table.location) table.location = { ...coords, updated: now };
    this.#emit(table);
    return tableView(table, player.id);
  }

  leave(code: string, playerId: string) {
    const table = this.#get(code);
    const idx = table.players.findIndex((p) => p.id === playerId);
    if (idx < 0) return { ok: true };
    table.players.splice(idx, 1);
    if (table.turn >= table.players.length) table.turn = 0;
    const hasHumans = table.players.some((p) => !p.isBot);
    if (!hasHumans) {
      this.#tables.delete(table.code);
      return { ok: true };
    }
    this.#emit(table);
    return { ok: true };
  }

  state(code: string, playerId: string) {
    return tableView(this.#get(code), playerId);
  }

  rename(code: string, playerId: string, name: string) {
    const table = this.#get(code);
    const seat = table.players.find((p) => p.id === playerId);
    if (!seat) throw new ApiError(403, "Not seated at this table");
    seat.name = cleanName(name, seat.name);
    this.#emit(table);
    return tableView(table, playerId);
  }

  shareLocation(code: string, playerId: string, lat: number, lon: number) {
    const table = this.#get(code);
    if (!table.players.some((p) => p.id === playerId)) throw new ApiError(403, "Not seated at this table");
    const coords = validCoords(lat, lon);
    if (!coords) throw new ApiError(400, "Invalid coordinates");
    table.location = { ...coords, updated: Date.now() };
    this.#emit(table);
    return tableView(table, playerId);
  }

  addBot(code: string, playerId: string) {
    const table = this.#get(code);
    if (!table.players.some((p) => p.id === playerId)) throw new ApiError(403, "Not seated at this table");
    if (table.players.length >= MAX_PLAYERS) throw new ApiError(409, "Table is full");
    const botNum = table.players.filter((p) => p.isBot).length + 1;
    table.players.push({
      id: `bot_${crypto.randomUUID().slice(0, 8)}`,
      name: `Bot ${botNum}`,
      hand: [],
      tricks: 0,
      points: 0,
      lives: 3,
      isBot: true,
      lastSeen: Date.now(),
    });
    this.#emit(table);
    return tableView(table, playerId);
  }

  removeBots(code: string, playerId: string) {
    const table = this.#get(code);
    if (!table.players.some((p) => p.id === playerId)) throw new ApiError(403, "Not seated at this table");
    table.players = table.players.filter((p) => !p.isBot);
    if (table.turn >= table.players.length) table.turn = 0;
    this.#emit(table);
    return tableView(table, playerId);
  }

  /** Fill up seats with bots (4 in Jass/A-löchlen, 3 in Tschau Sepp/Hose abe, 2 in free mode) and deal immediately. */
  quickStart(code: string, playerId: string) {
    const table = this.#get(code);
    if (!table.players.some((p) => p.id === playerId)) throw new ApiError(403, "Not seated at this table");
    const target = table.mode === "jass" || table.mode === "aloechlen" ? 4 : table.mode === "free" ? 2 : 3;
    while (table.players.length < target) {
      const botNum = table.players.filter((p) => p.isBot).length + 1;
      table.players.push({
        id: `bot_${crypto.randomUUID().slice(0, 8)}`,
        name: `Bot ${botNum}`,
        hand: [],
        tricks: 0,
        points: 0,
        lives: 3,
        isBot: true,
        lastSeen: Date.now(),
      });
    }
    return this.deal(code, playerId);
  }

  configure(
    code: string,
    playerId: string,
    opts: { deck?: DeckId; mode?: GameMode; trump?: Trump; dealCount?: number; name?: string },
  ) {
    const table = this.#get(code);
    if (!table.players.some((p) => p.id === playerId)) throw new ApiError(403, "Not seated at this table");
    if (opts.deck !== undefined) {
      if (!isDeckId(opts.deck)) throw new ApiError(400, "Unknown deck");
      table.deck = opts.deck;
      table.trump = "";
      table.wishSuit = "";
    }
    if (opts.mode === "jass" || opts.mode === "tschau" || opts.mode === "aloechlen" || opts.mode === "hoseabe" || opts.mode === "free") {
      table.mode = opts.mode;
      if (opts.dealCount === undefined) table.dealCount = opts.mode === "jass" ? 9 : 7;
    }
    if (opts.dealCount !== undefined) {
      const n = Math.round(Number(opts.dealCount));
      if (Number.isFinite(n) && n >= 1 && n <= 18) table.dealCount = n;
    }
    if (opts.name !== undefined) table.name = cleanName(opts.name, table.name);
    if (opts.trump !== undefined) {
      const validSuits = DECKS[table.deck].suits.map((s) => s.id);
      if (opts.trump === "" || opts.trump === "obe" || opts.trump === "unde" || validSuits.includes(opts.trump)) {
        table.trump = opts.trump;
      }
    }
    this.#emit(table);
    return tableView(table, playerId);
  }

  deal(code: string, playerId: string, opts: { dealCount?: number; trump?: Trump } = {}) {
    const table = this.#get(code);
    if (!table.players.some((p) => p.id === playerId)) throw new ApiError(403, "Not seated at this table");
    if (!table.players.length) throw new ApiError(400, "No players at table");

    const cards = shuffle(buildDeck(table.deck));
    const count = table.players.length;
    table.drawPile = [];
    table.pile = [];
    table.lastTrick = null;
    table.trickComplete = false;
    table.direction = 1;
    table.pendingDraw = 0;
    table.wishSuit = "";
    table.winnerId = null;
    table.banner = "";
    table.comboCount = 0;
    table.lastPlayerId = null;
    table.passedIds = [];
    table.finishOrder = [];
    table.knockerId = null;
    table.round++;

    if (table.mode === "hoseabe") {
      if (table.round === 1 || table.players.filter((p) => p.lives >= 0).length <= 1) {
        for (const p of table.players) p.lives = 3;
      }
      for (const p of table.players) {
        p.hand = p.lives >= 0 ? sortHand(cards.splice(0, 3), table.deck) : [];
        p.tricks = 0;
      }
      for (let i = 0; i < 3 && cards.length; i++) {
        table.pile.push({ card: cards.pop()!, playerId: "", playerName: "Mitte", x: 0, y: 0, rot: 0 });
      }
      table.drawPile = cards;
      let start = (table.round - 1) % count;
      for (let i = 0; i < count; i++) {
        const idx = (start + i) % count;
        if (table.players[idx].lives >= 0) { start = idx; break; }
      }
      table.turn = start;
      this.#advanceBots(table);
      this.#emit(table);
      return tableView(table, playerId);
    }

    const requested = opts.dealCount ? Math.round(Number(opts.dealCount)) : table.dealCount;
    const maxPerPlayer = Math.floor(cards.length / count);
    const perPlayer = table.mode === "jass"
      ? Math.min(9, maxPerPlayer)
      : table.mode === "aloechlen"
      ? Math.max(1, maxPerPlayer)
      : Math.max(1, Math.min(requested || 7, maxPerPlayer));

    for (let i = 0; i < count; i++) {
      const p = table.players[i];
      p.hand = sortHand(cards.splice(0, perPlayer), table.deck);
      p.tricks = 0;
    }
    table.drawPile = table.mode === "aloechlen" ? [] : cards;
    table.turn = (table.round - 1) % count;

    // A-löchlen: automatic card swap between Präsident (best) and A-loch (worst) from previous round
    if (table.mode === "aloechlen" && table.prevFinishOrder.length >= 2) {
      const pres = table.players.find((p) => p.id === table.prevFinishOrder[0]);
      const last = table.players.find((p) => p.id === table.prevFinishOrder.at(-1));
      if (pres && last && pres.id !== last.id) {
        this.#swapRankCards(pres, last, count >= 4 ? 2 : 1, table.deck);
        if (count >= 4) {
          const vice = table.players.find((p) => p.id === table.prevFinishOrder[1]);
          const viceLast = table.players.find((p) => p.id === table.prevFinishOrder.at(-2));
          if (vice && viceLast && vice.id !== viceLast.id) this.#swapRankCards(vice, viceLast, 1, table.deck);
        }
        table.banner = "Kartentausch: Präsident / A-loch";
      }
    }

    if (opts.trump !== undefined) table.trump = opts.trump;
    else if (table.mode === "jass" && !table.trump) {
      table.trump = "";
    }

    // Flip one starter card onto the discard pile for Tschau Sepp and free table mode.
    if ((table.mode === "tschau" || table.mode === "free") && table.drawPile.length > 0) {
      const starter = table.drawPile.pop()!;
      table.pile.push({ card: starter, playerId: "", playerName: "Stapel", x: 0, y: 0, rot: -0.04 });
    }

    this.#advanceBots(table);
    this.#emit(table);
    return tableView(table, playerId);
  }

  #swapRankCards(winner: Seat, loser: Seat, count: number, deckId: DeckId) {
    if (winner.hand.length < count || loser.hand.length < count) return;
    const byRankAsc = (a: Card, b: Card) => rankOrder(a.rank) - rankOrder(b.rank);
    const giveToLoser = [...winner.hand].sort(byRankAsc).slice(0, count);
    const giveToWinner = [...loser.hand].sort(byRankAsc).slice(-count);
    winner.hand = sortHand([...winner.hand.filter((c) => !giveToLoser.includes(c)), ...giveToWinner], deckId);
    loser.hand = sortHand([...loser.hand.filter((c) => !giveToWinner.includes(c)), ...giveToLoser], deckId);
  }

  #stepTurn(table: Table, seatIdx: number, steps = 1) {
    const n = table.players.length;
    if (!n) return 0;
    return ((seatIdx + steps * table.direction) % n + n) % n;
  }

  #drawOne(table: Table): Card | null {
    if (!table.drawPile.length) {
      if (table.pile.length > 1) {
        const top = table.pile.pop()!;
        table.drawPile = shuffle(table.pile.map((e) => e.card));
        table.pile = [top];
      } else {
        return null;
      }
    }
    return table.drawPile.pop() ?? null;
  }

  #applyTschauPlay(table: Table, seatIdx: number, seat: Seat, card: Card, wishSuit?: string) {
    const seed = table.version + table.pile.length * 7 + seatIdx * 13;
    table.pile.push({
      card,
      playerId: seat.id,
      playerName: seat.name,
      x: (jitter(seed) - 0.5) * 0.22,
      y: (jitter(seed + 1) - 0.5) * 0.16,
      rot: (jitter(seed + 2) - 0.5) * 0.32,
    });

    table.wishSuit = "";
    let step = 1;
    if (card.rank === "7") {
      table.pendingDraw += 2;
      table.banner = `+${table.pendingDraw}!`;
    } else if (card.rank === "8") {
      table.banner = "Aussetzen!";
      step = 2;
    } else if (card.rank === "10") {
      table.direction = table.direction === 1 ? -1 : 1;
      table.banner = "Richtungswechsel!";
      step = table.players.length === 2 ? 0 : 1;
    } else if (card.rank === "A") {
      table.banner = "Ass — nochmal!";
      step = 0;
    } else if (card.rank === "J") {
      const validSuits = DECKS[table.deck].suits.map((s) => s.id);
      const chosen = wishSuit && validSuits.includes(wishSuit) ? wishSuit : card.suit;
      table.wishSuit = chosen;
      const suitName = DECKS[table.deck].suits.find((s) => s.id === chosen)?.name ?? chosen;
      table.banner = `Wunsch: ${suitName}`;
    } else {
      table.banner = "";
    }

    if (seat.hand.length === 1) table.banner = `Tschau! (${seat.name})`;
    if (seat.hand.length === 0) {
      table.winnerId = seat.id;
      seat.points++;
      table.banner = `Sepp! ${seat.name} gewinnt!`;
    } else {
      table.turn = this.#stepTurn(table, seatIdx, step);
    }
  }

  play(code: string, playerId: string, cardId: string, opts: { wishSuit?: string } = {}) {
    const table = this.#get(code);
    const seatIdx = table.players.findIndex((p) => p.id === playerId);
    if (seatIdx < 0) throw new ApiError(403, "Not seated at this table");
    const seat = table.players[seatIdx];

    // If a previous Jass trick is still sitting complete on the table, collect it first automatically.
    if (table.mode === "jass" && table.trickComplete) this.#collectTrick(table);

    if ((table.mode === "tschau" || table.mode === "aloechlen" || table.mode === "hoseabe") && table.winnerId) {
      throw new ApiError(400, "Runde beendet — bitte neu geben");
    }
    if (table.mode === "hoseabe") {
      throw new ApiError(400, "Bei Hose abe eine Handkarte mit der Mitte tauschen");
    }

    const cardIdx = seat.hand.findIndex((c) => c.id === cardId);
    if (cardIdx < 0) throw new ApiError(400, "Card not in hand");

    if (table.mode === "tschau") {
      const candidate = seat.hand[cardIdx];
      if (!canPlayTschau(candidate, table.pile.at(-1)?.card, table.wishSuit, table.pendingDraw)) {
        throw new ApiError(400, table.pendingDraw > 0 ? "Nur 7 oder Karten ziehen!" : "Passt nicht — andere Karte oder ziehen");
      }
      seat.hand.splice(cardIdx, 1);
      this.#applyTschauPlay(table, seatIdx, seat, candidate, opts.wishSuit);
      if (!table.winnerId) this.#advanceBots(table);
      this.#emit(table);
      return tableView(table, playerId);
    }

    if (table.mode === "aloechlen") {
      if (table.players[table.turn]?.id !== seat.id) throw new ApiError(400, "Du bist nicht dran");
      const candidate = seat.hand[cardIdx];
      const topRank = table.pile.at(-1)?.card.rank ?? null;
      if (!canPlayAloechlen(seat.hand, candidate, topRank, table.comboCount)) {
        throw new ApiError(400, "Zu tief oder zu wenige gleiche Karten");
      }
      this.#applyAloechlenPlay(table, seatIdx, seat, candidate);
      if (!table.winnerId) this.#advanceBots(table);
      this.#emit(table);
      return tableView(table, playerId);
    }

    const [card] = seat.hand.splice(cardIdx, 1);
    const seed = table.version + table.pile.length * 7 + seatIdx * 13;
    table.pile.push({
      card,
      playerId: seat.id,
      playerName: seat.name,
      x: (jitter(seed) - 0.5) * 0.22,
      y: (jitter(seed + 1) - 0.5) * 0.16,
      rot: (jitter(seed + 2) - 0.5) * 0.32,
    });

    if (table.mode === "jass") {
      if (table.pile.length >= table.players.length) {
        table.trickComplete = true;
      } else {
        table.turn = (seatIdx + 1) % table.players.length;
        this.#advanceBots(table);
      }
    } else {
      table.turn = (seatIdx + 1) % table.players.length;
      this.#advanceBots(table);
    }

    this.#emit(table);
    return tableView(table, playerId);
  }

  #nextActiveSeat(table: Table, fromIdx: number, pred: (s: Seat) => boolean): number {
    const n = table.players.length;
    for (let i = 1; i <= n; i++) {
      const idx = (fromIdx + i) % n;
      if (pred(table.players[idx])) return idx;
    }
    return fromIdx;
  }

  #applyAloechlenPlay(table: Table, seatIdx: number, seat: Seat, candidate: Card) {
    const matching = seat.hand.filter((c) => c.rank === candidate.rank);
    const count = table.comboCount > 0 ? table.comboCount : matching.length;
    const played = matching.slice(0, count);
    const playedIds = new Set(played.map((c) => c.id));
    seat.hand = seat.hand.filter((c) => !playedIds.has(c.id));

    table.pile = played.map((card, i) => {
      const seed = table.version + i * 9 + seatIdx * 13;
      return {
        card,
        playerId: seat.id,
        playerName: seat.name,
        x: (i - (played.length - 1) / 2) * 0.28 + (jitter(seed) - 0.5) * 0.08,
        y: (jitter(seed + 1) - 0.5) * 0.08,
        rot: (jitter(seed + 2) - 0.5) * 0.16,
      };
    });
    table.comboCount = played.length;
    table.lastPlayerId = seat.id;
    table.passedIds = [];
    table.banner = played.length > 1 ? `${played.length}× ${candidate.rank}` : "";

    if (seat.hand.length === 0 && !table.finishOrder.includes(seat.id)) {
      table.finishOrder.push(seat.id);
    }
    const remaining = table.players.filter((p) => p.hand.length > 0);
    if (remaining.length <= 1) {
      if (remaining.length === 1 && !table.finishOrder.includes(remaining[0].id)) {
        table.finishOrder.push(remaining[0].id);
      }
      table.prevFinishOrder = [...table.finishOrder];
      table.winnerId = table.finishOrder[0] ?? seat.id;
      const winSeat = table.players.find((p) => p.id === table.winnerId);
      if (winSeat) {
        winSeat.points++;
        table.banner = `Präsident: ${winSeat.name}!`;
      }
      return;
    }
    table.turn = this.#nextActiveSeat(table, seatIdx, (p) => p.hand.length > 0);
  }

  #applyAloechlenPass(table: Table, seatIdx: number, seat: Seat) {
    if (!table.passedIds.includes(seat.id)) table.passedIds.push(seat.id);
    const active = table.players.filter((p) => p.hand.length > 0);
    const needPasses = active.filter((p) => p.id !== table.lastPlayerId);
    const allPassed = needPasses.every((p) => table.passedIds.includes(p.id));
    if (allPassed) {
      table.pile = [];
      table.comboCount = 0;
      table.passedIds = [];
      table.banner = "Stapel abgeräumt";
      const leaderIdx = table.players.findIndex((p) => p.id === table.lastPlayerId && p.hand.length > 0);
      table.turn = leaderIdx >= 0 ? leaderIdx : this.#nextActiveSeat(table, seatIdx, (p) => p.hand.length > 0);
    } else {
      table.turn = this.#nextActiveSeat(table, seatIdx, (p) => p.hand.length > 0 && !table.passedIds.includes(p.id) && p.id !== table.lastPlayerId || p.id === table.lastPlayerId);
      // Prefer next active non-passed player
      const nextIdx = this.#nextActiveSeat(table, seatIdx, (p) => p.hand.length > 0 && !table.passedIds.includes(p.id));
      table.turn = nextIdx;
    }
  }

  #finishHoseRound(table: Table, instantWinnerId?: string) {
    const active = table.players.filter((p) => p.lives >= 0);
    if (!active.length) return;
    if (instantWinnerId) {
      for (const p of active) if (p.id !== instantWinnerId) p.lives--;
      const winner = active.find((p) => p.id === instantWinnerId);
      table.winnerId = instantWinnerId;
      if (winner) {
        winner.points++;
        table.banner = `31! ${winner.name} gewinnt!`;
      }
      return;
    }
    const scored = active.map((p) => ({ p, score: hoseScore(p.hand) }));
    const minScore = Math.min(...scored.map((s) => s.score));
    const maxScore = Math.max(...scored.map((s) => s.score));
    const losers: string[] = [];
    for (const item of scored) {
      if (item.score === minScore) {
        item.p.lives--;
        losers.push(item.p.name);
      }
    }
    const winner = scored.find((s) => s.score === maxScore)?.p ?? active[0];
    table.winnerId = winner.id;
    winner.points++;
    const survivors = table.players.filter((p) => p.lives >= 0);
    table.banner = survivors.length <= 1
      ? `${winner.name} gewinnt das Spiel!`
      : `${losers.join(", ")} verliert Leben (${minScore} P.)`;
  }

  pass(code: string, playerId: string) {
    const table = this.#get(code);
    const seatIdx = table.players.findIndex((p) => p.id === playerId);
    if (seatIdx < 0) throw new ApiError(403, "Not seated at this table");
    const seat = table.players[seatIdx];
    if (table.winnerId) throw new ApiError(400, "Runde beendet — bitte neu geben");
    if (table.players[table.turn]?.id !== seat.id) throw new ApiError(400, "Du bist nicht dran");

    if (table.mode === "aloechlen") {
      if (!table.pile.length) throw new ApiError(400, "Du musst anspielen");
      this.#applyAloechlenPass(table, seatIdx, seat);
      if (!table.winnerId) this.#advanceBots(table);
      this.#emit(table);
      return tableView(table, playerId);
    }

    if (table.mode === "hoseabe") {
      if (seat.lives < 0) throw new ApiError(400, "Du bist ausgeschieden");
      if (!table.knockerId) {
        table.knockerId = seat.id;
        table.banner = `${seat.name} klopft — letzte Runde!`;
      }
      const nextIdx = this.#nextActiveSeat(table, seatIdx, (p) => p.lives >= 0);
      if (table.players[nextIdx]?.id === table.knockerId) {
        this.#finishHoseRound(table);
      } else {
        table.turn = nextIdx;
        this.#advanceBots(table);
      }
      this.#emit(table);
      return tableView(table, playerId);
    }

    throw new ApiError(400, "Passen ist in diesem Modus nicht aktiv");
  }

  swap(code: string, playerId: string, cardId: string, tableIndex: number) {
    const table = this.#get(code);
    if (table.mode !== "hoseabe") throw new ApiError(400, "Tauschen nur bei Hose abe");
    const seatIdx = table.players.findIndex((p) => p.id === playerId);
    if (seatIdx < 0) throw new ApiError(403, "Not seated at this table");
    const seat = table.players[seatIdx];
    if (table.winnerId) throw new ApiError(400, "Runde beendet — bitte neu geben");
    if (seat.lives < 0) throw new ApiError(400, "Du bist ausgeschieden");
    if (table.players[table.turn]?.id !== seat.id) throw new ApiError(400, "Du bist nicht dran");

    if (tableIndex === -1) {
      const oldHand = seat.hand;
      seat.hand = sortHand(table.pile.map((e) => e.card), table.deck);
      table.pile = oldHand.map((card) => ({ card, playerId: seat.id, playerName: seat.name, x: 0, y: 0, rot: 0 }));
      table.banner = `${seat.name} tauscht alle 3`;
    } else {
      if (tableIndex < 0 || tableIndex >= table.pile.length) throw new ApiError(400, "Invalid table card");
      const handIdx = seat.hand.findIndex((c) => c.id === cardId);
      if (handIdx < 0) throw new ApiError(400, "Card not in hand");
      const picked = table.pile[tableIndex].card;
      const given = seat.hand[handIdx];
      seat.hand[handIdx] = picked;
      seat.hand = sortHand(seat.hand, table.deck);
      table.pile[tableIndex] = { card: given, playerId: seat.id, playerName: seat.name, x: 0, y: 0, rot: 0 };
      table.banner = `${seat.name} tauscht`;
    }

    if (hoseScore(seat.hand) >= 31) {
      this.#finishHoseRound(table, seat.id);
    } else {
      const nextIdx = this.#nextActiveSeat(table, seatIdx, (p) => p.lives >= 0);
      if (table.knockerId && table.players[nextIdx]?.id === table.knockerId) {
        this.#finishHoseRound(table);
      } else {
        table.turn = nextIdx;
        this.#advanceBots(table);
      }
    }
    this.#emit(table);
    return tableView(table, playerId);
  }

  draw(code: string, playerId: string) {
    const table = this.#get(code);
    const seatIdx = table.players.findIndex((p) => p.id === playerId);
    if (seatIdx < 0) throw new ApiError(403, "Not seated at this table");
    const seat = table.players[seatIdx];

    if (table.mode === "tschau") {
      if (table.winnerId) throw new ApiError(400, "Runde beendet — bitte neu geben");
      const count = Math.max(1, table.pendingDraw);
      const drawn: Card[] = [];
      for (let i = 0; i < count; i++) {
        const c = this.#drawOne(table);
        if (!c) break;
        drawn.push(c);
      }
      if (!drawn.length) throw new ApiError(400, "Draw pile is empty");
      seat.hand = sortHand([...seat.hand, ...drawn], table.deck);
      table.pendingDraw = 0;
      table.banner = drawn.length > 1 ? `${seat.name} zieht ${drawn.length}` : "";
      table.turn = this.#stepTurn(table, seatIdx, 1);
      this.#advanceBots(table);
      this.#emit(table);
      return tableView(table, playerId);
    }

    const card = this.#drawOne(table);
    if (!card) throw new ApiError(400, "Draw pile is empty");
    seat.hand = sortHand([...seat.hand, card], table.deck);
    this.#emit(table);
    return tableView(table, playerId);
  }

  takePile(code: string, playerId: string) {
    const table = this.#get(code);
    const seat = table.players.find((p) => p.id === playerId);
    if (!seat) throw new ApiError(403, "Not seated at this table");
    if (!table.pile.length) return tableView(table, playerId);

    if (table.mode === "jass") {
      this.#collectTrick(table);
      this.#advanceBots(table);
    } else {
      seat.hand = sortHand([...seat.hand, ...table.pile.map((p) => p.card)], table.deck);
      table.pile = [];
    }
    this.#emit(table);
    return tableView(table, playerId);
  }

  clearPile(code: string, playerId: string) {
    const table = this.#get(code);
    if (!table.players.some((p) => p.id === playerId)) throw new ApiError(403, "Not seated at this table");
    table.pile = [];
    table.trickComplete = false;
    this.#emit(table);
    return tableView(table, playerId);
  }

  #collectTrick(table: Table) {
    if (!table.pile.length) return;
    const isLast = table.players.every((p) => p.hand.length === 0);
    const { winnerIndex, points } = scoreTrick(table.pile, table.trump, isLast);
    const winnerEntry = table.pile[winnerIndex];
    const winner = table.players.find((p) => p.id === winnerEntry?.playerId);
    if (winner) {
      winner.tricks++;
      winner.points += points;
      table.turn = table.players.indexOf(winner);
      table.lastTrick = {
        winnerId: winner.id,
        winnerName: winner.name,
        points,
        cards: table.pile.map((p) => p.card),
      };
    }
    table.pile = [];
    table.trickComplete = false;
  }

  #advanceBots(table: Table) {
    if (table.mode === "aloechlen") {
      let guard = 0;
      while (guard++ < 16 && !table.winnerId) {
        const seatIdx = table.turn;
        const current = table.players[seatIdx];
        if (!current || !current.isBot || !current.hand.length) break;
        const topRank = table.pile.at(-1)?.card.rank ?? null;
        const playable = current.hand.filter((c) => canPlayAloechlen(current.hand, c, topRank, table.comboCount));
        if (playable.length) {
          // Bots play lowest valid card
          const chosen = [...playable].sort((a, b) => rankOrder(a.rank) - rankOrder(b.rank))[0];
          this.#applyAloechlenPlay(table, seatIdx, current, chosen);
        } else if (table.pile.length) {
          this.#applyAloechlenPass(table, seatIdx, current);
        } else {
          break;
        }
      }
      return;
    }

    if (table.mode === "hoseabe") {
      let guard = 0;
      while (guard++ < 12 && !table.winnerId) {
        const seatIdx = table.turn;
        const current = table.players[seatIdx];
        if (!current || !current.isBot || current.lives < 0) break;
        const baseScore = hoseScore(current.hand);
        let bestMove: { handIdx: number; tableIdx: number; score: number } | null = null;
        for (let hi = 0; hi < current.hand.length; hi++) {
          for (let ti = 0; ti < table.pile.length; ti++) {
            const testHand = [...current.hand];
            testHand[hi] = table.pile[ti].card;
            const sc = hoseScore(testHand);
            if (sc > (bestMove?.score ?? baseScore)) bestMove = { handIdx: hi, tableIdx: ti, score: sc };
          }
        }
        if (bestMove) {
          const given = current.hand[bestMove.handIdx];
          current.hand[bestMove.handIdx] = table.pile[bestMove.tableIdx].card;
          current.hand = sortHand(current.hand, table.deck);
          table.pile[bestMove.tableIdx] = { card: given, playerId: current.id, playerName: current.name, x: 0, y: 0, rot: 0 };
          table.banner = `${current.name} tauscht`;
          if (hoseScore(current.hand) >= 31) {
            this.#finishHoseRound(table, current.id);
            break;
          }
        } else if (!table.knockerId && baseScore >= 24) {
          table.knockerId = current.id;
          table.banner = `${current.name} klopft — letzte Runde!`;
        } else if (table.pile.length && current.hand.length) {
          // Swap weakest card with first center card to keep game moving
          const given = current.hand[0];
          current.hand[0] = table.pile[0].card;
          current.hand = sortHand(current.hand, table.deck);
          table.pile[0] = { card: given, playerId: current.id, playerName: current.name, x: 0, y: 0, rot: 0 };
          table.banner = `${current.name} tauscht`;
        }
        const nextIdx = this.#nextActiveSeat(table, seatIdx, (p) => p.lives >= 0);
        if (table.knockerId && table.players[nextIdx]?.id === table.knockerId) {
          this.#finishHoseRound(table);
          break;
        }
        table.turn = nextIdx;
      }
      return;
    }

    if (table.mode === "tschau") {
      let guard = 0;
      while (guard++ < 12 && !table.winnerId) {
        const seatIdx = table.turn;
        const current = table.players[seatIdx];
        if (!current || !current.isBot || !current.hand.length) break;
        const top = table.pile.at(-1)?.card;
        const playable = current.hand.filter((c) => canPlayTschau(c, top, table.wishSuit, table.pendingDraw));
        if (playable.length) {
          const chosen = playable.find((c) => c.rank !== "J") ?? playable[0];
          const idx = current.hand.indexOf(chosen);
          current.hand.splice(idx, 1);
          // Pick most common suit remaining in hand when bot plays a Under/Bube
          let wish = chosen.suit;
          if (chosen.rank === "J" && current.hand.length) {
            const counts = new Map<string, number>();
            for (const c of current.hand) counts.set(c.suit, (counts.get(c.suit) ?? 0) + 1);
            wish = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? chosen.suit;
          }
          this.#applyTschauPlay(table, seatIdx, current, chosen, wish);
        } else {
          const count = Math.max(1, table.pendingDraw);
          for (let i = 0; i < count; i++) {
            const drawn = this.#drawOne(table);
            if (!drawn) break;
            current.hand.push(drawn);
          }
          current.hand = sortHand(current.hand, table.deck);
          table.pendingDraw = 0;
          table.banner = `${current.name} zieht`;
          table.turn = this.#stepTurn(table, seatIdx, 1);
        }
      }
      return;
    }

    // Let consecutive bots play automatically so solo or 2-3 player Jass rounds flow smoothly.
    let guard = 0;
    while (guard++ < MAX_PLAYERS && !table.trickComplete) {
      const current = table.players[table.turn];
      if (!current || !current.isBot || !current.hand.length) break;
      const leadSuit = table.pile[0]?.card.suit;
      const sameSuit = leadSuit ? current.hand.filter((c) => c.suit === leadSuit) : [];
      const chosen = sameSuit[0] ?? current.hand[0];
      const idx = current.hand.indexOf(chosen);
      current.hand.splice(idx, 1);
      const seed = table.version + table.pile.length * 11 + guard * 5;
      table.pile.push({
        card: chosen,
        playerId: current.id,
        playerName: current.name,
        x: (jitter(seed) - 0.5) * 0.22,
        y: (jitter(seed + 1) - 0.5) * 0.16,
        rot: (jitter(seed + 2) - 0.5) * 0.32,
      });
      if (table.mode === "jass" && table.pile.length >= table.players.length) {
        table.trickComplete = true;
        break;
      }
      table.turn = (table.turn + 1) % table.players.length;
    }
  }
}
