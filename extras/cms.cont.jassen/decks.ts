/** Card deck definitions and Swiss Jass trick/scoring rules. */

export type DeckId = "swiss36" | "french36" | "french52" | "german32";
export type GameMode = "jass" | "tschau" | "aloechlen" | "hoseabe" | "free";
export type Trump = "" | "obe" | "unde" | string;

export type Suit = { id: string; name: string; symbol: string; color: string };
export type Rank = { id: string; label: string; short: string; order: number };
export type Card = { id: string; suit: string; rank: string };

const SWISS_SUITS: readonly Suit[] = [
  { id: "schellen", name: "Schellen", symbol: "S", color: "#d4940a" },
  { id: "schilten", name: "Schilten", symbol: "W", color: "#1d4ed8" },
  { id: "rosen", name: "Rosen", symbol: "R", color: "#c81e1e" },
  { id: "eicheln", name: "Eicheln", symbol: "E", color: "#15803d" },
];

const FRENCH_SUITS: readonly Suit[] = [
  { id: "hearts", name: "Herz", symbol: "♥", color: "#c81e1e" },
  { id: "diamonds", name: "Karo", symbol: "♦", color: "#c81e1e" },
  { id: "spades", name: "Pik", symbol: "♠", color: "#18181b" },
  { id: "clubs", name: "Kreuz", symbol: "♣", color: "#18181b" },
];

const GERMAN_SUITS: readonly Suit[] = [
  { id: "eichel", name: "Eichel", symbol: "♣", color: "#6b4226" },
  { id: "laub", name: "Laub", symbol: "♠", color: "#15803d" },
  { id: "herz", name: "Herz", symbol: "♥", color: "#c81e1e" },
  { id: "schellen", name: "Schellen", symbol: "♦", color: "#d4940a" },
];

const JASS_RANKS: readonly Rank[] = [
  { id: "6", label: "6", short: "6", order: 6 },
  { id: "7", label: "7", short: "7", order: 7 },
  { id: "8", label: "8", short: "8", order: 8 },
  { id: "9", label: "9", short: "9", order: 9 },
  { id: "10", label: "Banner", short: "10", order: 10 },
  { id: "J", label: "Under", short: "U", order: 11 },
  { id: "Q", label: "Ober", short: "O", order: 12 },
  { id: "K", label: "König", short: "K", order: 13 },
  { id: "A", label: "Ass", short: "A", order: 14 },
];

const FRENCH36_RANKS: readonly Rank[] = [
  { id: "6", label: "6", short: "6", order: 6 },
  { id: "7", label: "7", short: "7", order: 7 },
  { id: "8", label: "8", short: "8", order: 8 },
  { id: "9", label: "9", short: "9", order: 9 },
  { id: "10", label: "10", short: "10", order: 10 },
  { id: "J", label: "Bube", short: "J", order: 11 },
  { id: "Q", label: "Dame", short: "Q", order: 12 },
  { id: "K", label: "König", short: "K", order: 13 },
  { id: "A", label: "Ass", short: "A", order: 14 },
];

const FRENCH52_RANKS: readonly Rank[] = [
  { id: "2", label: "2", short: "2", order: 2 },
  { id: "3", label: "3", short: "3", order: 3 },
  { id: "4", label: "4", short: "4", order: 4 },
  { id: "5", label: "5", short: "5", order: 5 },
  ...FRENCH36_RANKS,
];

const GERMAN32_RANKS: readonly Rank[] = JASS_RANKS.slice(1); // 7 to Ass

export const DECKS: Record<DeckId, { id: DeckId; name: string; suits: readonly Suit[]; ranks: readonly Rank[] }> = {
  swiss36: { id: "swiss36", name: "Schweizer Jasskarten (36)", suits: SWISS_SUITS, ranks: JASS_RANKS },
  french36: { id: "french36", name: "Französische Jasskarten (36)", suits: FRENCH_SUITS, ranks: FRENCH36_RANKS },
  french52: { id: "french52", name: "Französisches Blatt (52)", suits: FRENCH_SUITS, ranks: FRENCH52_RANKS },
  german32: { id: "german32", name: "Deutsches Blatt / Skat (32)", suits: GERMAN_SUITS, ranks: GERMAN32_RANKS },
};

export const DECK_IDS = Object.keys(DECKS) as DeckId[];

export function isDeckId(v: unknown): v is DeckId {
  return typeof v === "string" && v in DECKS;
}

export function buildDeck(deckId: DeckId): Card[] {
  const deck = DECKS[deckId];
  const cards: Card[] = [];
  for (const suit of deck.suits) {
    for (const rank of deck.ranks) {
      cards.push({ id: `${suit.id}:${rank.id}`, suit: suit.id, rank: rank.id });
    }
  }
  return cards;
}

/** Cryptographically unbiased Fisher-Yates shuffle. */
export function shuffle<T>(items: readonly T[]): T[] {
  const out = [...items];
  const rand = new Uint32Array(out.length);
  crypto.getRandomValues(rand);
  for (let i = out.length - 1; i > 0; i--) {
    const j = rand[i] % (i + 1);
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
}

const RANK_ORDER: Record<string, number> = {
  "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7, "8": 8, "9": 9, "10": 10, J: 11, Q: 12, K: 13, A: 14,
};

const BASE_POINTS: Record<string, number> = { A: 11, K: 4, Q: 3, J: 2, "10": 10 };

/** Jass card point value under the active trump mode. */
export function cardPoints(card: Card, trump: Trump): number {
  if (trump === "obe") return card.rank === "8" ? 8 : BASE_POINTS[card.rank] ?? 0;
  if (trump === "unde") return card.rank === "6" ? 11 : card.rank === "A" ? 0 : card.rank === "8" ? 8 : BASE_POINTS[card.rank] ?? 0;
  if (trump && card.suit === trump) {
    if (card.rank === "J") return 20; // Puur / Buur
    if (card.rank === "9") return 14; // Nell
  }
  return BASE_POINTS[card.rank] ?? 0;
}

/** Rank strength within a trick for Jass comparison (higher wins). */
function trickStrength(card: Card, leadSuit: string, trump: Trump): number {
  const base = RANK_ORDER[card.rank] ?? 0;
  if (trump === "unde") return card.suit === leadSuit ? 100 - base : 0;
  if (trump === "obe" || !trump) return card.suit === leadSuit ? base : 0;
  if (card.suit === trump) {
    if (card.rank === "J") return 200; // Puur
    if (card.rank === "9") return 199; // Nell
    return 100 + base;
  }
  return card.suit === leadSuit ? base : 0;
}

/** Returns the winning entry index and total points for a Jass trick. */
export function scoreTrick(entries: readonly { card: Card; playerId: string }[], trump: Trump, lastTrick = false) {
  if (!entries.length) return { winnerIndex: -1, points: 0 };
  const leadSuit = entries[0].card.suit;
  let winnerIndex = 0;
  let best = trickStrength(entries[0].card, leadSuit, trump);
  let points = lastTrick ? 5 : 0;
  for (let i = 0; i < entries.length; i++) {
    points += cardPoints(entries[i].card, trump);
    const strength = trickStrength(entries[i].card, leadSuit, trump);
    if (strength > best) {
      best = strength;
      winnerIndex = i;
    }
  }
  return { winnerIndex, points };
}

/** Sort cards nicely by suit and rank for a player's hand. */
export function sortHand(hand: readonly Card[], deckId: DeckId): Card[] {
  const suits = DECKS[deckId].suits;
  const suitIdx = new Map(suits.map((s, i) => [s.id, i]));
  return [...hand].sort((a, b) => {
    const s = (suitIdx.get(a.suit) ?? 0) - (suitIdx.get(b.suit) ?? 0);
    return s !== 0 ? s : (RANK_ORDER[a.rank] ?? 0) - (RANK_ORDER[b.rank] ?? 0);
  });
}

/** Whether a card is legal to play in Tschau Sepp on top of `top` (respecting active wish suit and +2 chains). */
export function canPlayTschau(card: Card, top: Card | undefined, activeSuit: string, pendingDraw: number): boolean {
  if (pendingDraw > 0) return card.rank === "7";
  if (!top) return true;
  if (card.rank === "J") return true;
  return card.suit === (activeSuit || top.suit) || card.rank === top.rank;
}

export function rankOrder(rank: string): number {
  return RANK_ORDER[rank] ?? 0;
}

/** Hose abe (Schwimmen / 31) hand score: 33 for 3 Aces, 30.5 for 3 of a kind, else best suit sum. */
export function hoseScore(hand: readonly Card[]): number {
  if (!hand.length) return 0;
  if (hand.length === 3 && hand[0].rank === hand[1].rank && hand[1].rank === hand[2].rank) {
    return hand[0].rank === "A" ? 33 : 30.5;
  }
  const bySuit = new Map<string, number>();
  for (const c of hand) {
    const val = c.rank === "A" ? 11 : (c.rank === "K" || c.rank === "Q" || c.rank === "J" || c.rank === "10") ? 10 : Number(c.rank) || 0;
    bySuit.set(c.suit, (bySuit.get(c.suit) ?? 0) + val);
  }
  let best = 0;
  for (const sum of bySuit.values()) if (sum > best) best = sum;
  return best;
}

/** Whether `card` (and matching duplicates in `hand`) can lead or beat `(topRank, comboCount)` in A-löchlen. */
export function canPlayAloechlen(hand: readonly Card[], card: Card, topRank: string | null, comboCount: number): boolean {
  const sameCount = hand.filter((c) => c.rank === card.rank).length;
  if (!sameCount) return false;
  if (!topRank || comboCount <= 0) return true;
  return rankOrder(card.rank) > rankOrder(topRank) && sameCount >= comboCount;
}
