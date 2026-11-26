/** High-DPI procedural card renderer for Swiss, French and German decks. */

export const DECK_META = {
  swiss36: {
    name: "Schweizer Jasskarten (36)",
    stock: "#fbf7ee",
    back: "#b42025",
    suits: [
      { id: "schellen", name: "Schellen", color: "#c98300" },
      { id: "schilten", name: "Schilten", color: "#1d4ed8" },
      { id: "rosen", name: "Rosen", color: "#c81e1e" },
      { id: "eicheln", name: "Eicheln", color: "#15803d" },
    ],
    ranks: { "6": "6", "7": "7", "8": "8", "9": "9", "10": "10", J: "U", Q: "O", K: "K", A: "A" },
    titles: { "10": "BANNER", J: "UNDER", Q: "OBER", K: "KÖNIG", A: "ASS" },
  },
  french36: {
    name: "Französische Jasskarten (36)",
    stock: "#ffffff",
    back: "#1e3a5f",
    suits: [
      { id: "hearts", name: "Herz", color: "#c81e1e" },
      { id: "diamonds", name: "Karo", color: "#c81e1e" },
      { id: "spades", name: "Pik", color: "#18181b" },
      { id: "clubs", name: "Kreuz", color: "#18181b" },
    ],
    ranks: { "6": "6", "7": "7", "8": "8", "9": "9", "10": "10", J: "J", Q: "Q", K: "K", A: "A" },
    titles: { J: "BUBE", Q: "DAME", K: "KÖNIG", A: "ASS" },
  },
  french52: {
    name: "Französisches Blatt (52)",
    stock: "#ffffff",
    back: "#1e3a5f",
    suits: [
      { id: "hearts", name: "Herz", color: "#c81e1e" },
      { id: "diamonds", name: "Karo", color: "#c81e1e" },
      { id: "spades", name: "Pik", color: "#18181b" },
      { id: "clubs", name: "Kreuz", color: "#18181b" },
    ],
    ranks: {
      "2": "2", "3": "3", "4": "4", "5": "5", "6": "6", "7": "7",
      "8": "8", "9": "9", "10": "10", J: "J", Q: "Q", K: "K", A: "A",
    },
    titles: { J: "BUBE", Q: "DAME", K: "KÖNIG", A: "ASS" },
  },
  german32: {
    name: "Deutsches Blatt / Skat (32)",
    stock: "#faf6ec",
    back: "#1f5133",
    suits: [
      { id: "eichel", name: "Eichel", color: "#6b4226" },
      { id: "laub", name: "Laub", color: "#15803d" },
      { id: "herz", name: "Herz", color: "#c81e1e" },
      { id: "schellen", name: "Schellen", color: "#c98300" },
    ],
    ranks: { "7": "7", "8": "8", "9": "9", "10": "10", J: "U", Q: "O", K: "K", A: "A" },
    titles: { J: "UNTER", Q: "OBER", K: "KÖNIG", A: "ASS" },
  },
};

const cache = new Map();
const MAX_CACHE = 180;
const readyCallbacks = new Set();

const SWISS_SUIT_FILES = {
  schellen: "./decks/swiss-schellen.svg",
  schilten: "./decks/swiss-schilten.svg",
  rosen: "./decks/swiss-rosen.svg",
  eicheln: "./decks/swiss-eicheln.svg",
};
const swissSuitImgs = new Map();
let swissLoadPromise = null;

let frenchDefs = "";
let frenchLoadPromise = null;
const frenchCardImgs = new Map();
const frenchCardLoading = new Set();
const FRENCH_SUITS = { hearts: "heart", diamonds: "diamond", spades: "spade", clubs: "club" };
const FRENCH_RANKS = { A: "1", J: "jack", Q: "queen", K: "king" };

function notifyReady() {
  for (const fn of readyCallbacks) fn();
}

function clearDeckCache(prefix) {
  for (const k of cache.keys()) {
    if (k.startsWith(prefix)) cache.delete(k);
  }
}

function loadSvgBlobImage(svgText) {
  const fixed = svgText.includes("viewBox")
    ? svgText
    : svgText.replace(/<svg\b([^>]*)>/i, (m, attrs) => {
      const w = attrs.match(/\bwidth=["']([\d.]+)/)?.[1];
      const h = attrs.match(/\bheight=["']([\d.]+)/)?.[1];
      return w && h ? `<svg${attrs} viewBox="0 0 ${w} ${h}">` : m;
    });
  const blob = new Blob([fixed], { type: "image/svg+xml" });
  const blobUrl = URL.createObjectURL(blob);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(blobUrl); resolve(img); };
    img.onerror = (e) => { URL.revokeObjectURL(blobUrl); reject(e); };
    img.src = blobUrl;
  });
}

function requestFrenchCard(svgId, cacheKey) {
  if (!frenchDefs || frenchCardImgs.has(svgId) || frenchCardLoading.has(svgId)) return null;
  frenchCardLoading.add(svgId);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 169.075 244.640">${frenchDefs}<use xlink:href="#${svgId}" x="0" y="0"/></svg>`;
  loadSvgBlobImage(svg).then((img) => {
    frenchCardLoading.delete(svgId);
    frenchCardImgs.set(svgId, img);
    cache.delete(cacheKey);
    notifyReady();
  }).catch(() => {
    frenchCardLoading.delete(svgId);
  });
  return null;
}

/** Lazily load external SVG artwork for Swiss or French decks, calling `onReady` when redraw is needed. */
export function loadDeckAssets(deckId, onReady) {
  if (typeof onReady === "function") readyCallbacks.add(onReady);
  if (deckId === "swiss36" && !swissLoadPromise) {
    swissLoadPromise = Promise.all(
      Object.entries(SWISS_SUIT_FILES).map(([suit, rel]) =>
        fetch(new URL(rel, import.meta.url))
          .then((r) => (r.ok ? r.text() : Promise.reject(r.statusText)))
          .then(loadSvgBlobImage)
          .then((img) => { swissSuitImgs.set(suit, img); })
          .catch(() => {})
      ),
    ).then(() => {
      clearDeckCache("f:swiss36:");
      notifyReady();
    });
  } else if ((deckId === "french36" || deckId === "french52") && !frenchLoadPromise) {
    frenchLoadPromise = fetch(new URL("./decks/french.svg", import.meta.url))
      .then((r) => (r.ok ? r.text() : Promise.reject(r.statusText)))
      .then((text) => {
        const start = text.indexOf("<defs>");
        const end = text.lastIndexOf("</defs>");
        if (start >= 0 && end > start) {
          frenchDefs = text.slice(start, end + 7);
          clearDeckCache("f:french");
          clearDeckCache("b:french");
          notifyReady();
        }
      })
      .catch(() => {});
  }
}

function trimCache() {
  if (cache.size <= MAX_CACHE) return;
  const keys = cache.keys();
  for (let i = 0; i < 40; i++) {
    const k = keys.next().value;
    if (k !== undefined) cache.delete(k);
  }
}

function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

/** Draw any Swiss, French or German suit emblem centered at (cx, cy) with radius r. */
export function drawSuit(ctx, suit, cx, cy, r) {
  const swissImg = swissSuitImgs.get(suit);
  if (swissImg) {
    const iw = swissImg.naturalWidth || 100;
    const ih = swissImg.naturalHeight || 100;
    const scale = Math.min((r * 2.15) / iw, (r * 2.15) / ih);
    const dw = iw * scale;
    const dh = ih * scale;
    ctx.drawImage(swissImg, cx - dw / 2, cy - dh / 2, dw, dh);
    return;
  }

  ctx.save();
  ctx.translate(cx, cy);

  if (suit === "hearts" || suit === "herz") {
    ctx.fillStyle = "#c81e1e";
    ctx.beginPath();
    ctx.moveTo(0, r * 0.85);
    ctx.bezierCurveTo(-r * 1.15, r * 0.15, -r * 0.95, -r * 0.9, 0, -r * 0.25);
    ctx.bezierCurveTo(r * 0.95, -r * 0.9, r * 1.15, r * 0.15, 0, r * 0.85);
    ctx.fill();
  } else if (suit === "diamonds") {
    ctx.fillStyle = "#c81e1e";
    ctx.beginPath();
    ctx.moveTo(0, -r);
    ctx.lineTo(r * 0.72, 0);
    ctx.lineTo(0, r);
    ctx.lineTo(-r * 0.72, 0);
    ctx.closePath();
    ctx.fill();
  } else if (suit === "spades") {
    ctx.fillStyle = "#18181b";
    ctx.beginPath();
    ctx.moveTo(0, -r * 0.95);
    ctx.bezierCurveTo(r * 1.05, -r * 0.15, r * 0.9, r * 0.65, 0, r * 0.25);
    ctx.bezierCurveTo(-r * 0.9, r * 0.65, -r * 1.05, -r * 0.15, 0, -r * 0.95);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(0, r * 0.1);
    ctx.lineTo(r * 0.28, r * 0.92);
    ctx.lineTo(-r * 0.28, r * 0.92);
    ctx.closePath();
    ctx.fill();
  } else if (suit === "clubs") {
    ctx.fillStyle = "#18181b";
    const cr = r * 0.42;
    for (const [x, y] of [[0, -r * 0.44], [-r * 0.44, r * 0.14], [r * 0.44, r * 0.14]]) {
      ctx.beginPath();
      ctx.arc(x, y, cr, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(r * 0.26, r * 0.92);
    ctx.lineTo(-r * 0.26, r * 0.92);
    ctx.closePath();
    ctx.fill();
  } else if (suit === "schellen") {
    // Swiss/German golden jingle bell
    const g = ctx.createRadialGradient(-r * 0.25, -r * 0.25, r * 0.1, 0, 0, r);
    g.addColorStop(0, "#fde047");
    g.addColorStop(0.55, "#eab308");
    g.addColorStop(1, "#a16207");
    // Top loop
    ctx.strokeStyle = "#92400e";
    ctx.lineWidth = Math.max(1.2, r * 0.14);
    ctx.beginPath();
    ctx.arc(0, -r * 0.78, r * 0.22, 0, Math.PI * 2);
    ctx.stroke();
    // Bell sphere
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, r * 0.08, r * 0.78, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#854d0e";
    ctx.lineWidth = Math.max(1, r * 0.09);
    ctx.stroke();
    // Equator ridge
    ctx.beginPath();
    ctx.moveTo(-r * 0.76, r * 0.08);
    ctx.lineTo(r * 0.76, r * 0.08);
    ctx.stroke();
    // Sound slit + keyhole
    ctx.fillStyle = "#451a03";
    ctx.beginPath();
    ctx.arc(-r * 0.3, r * 0.42, r * 0.11, 0, Math.PI * 2);
    ctx.arc(r * 0.3, r * 0.42, r * 0.11, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(-r * 0.3, r * 0.38, r * 0.6, r * 0.09);
  } else if (suit === "schilten") {
    // Swiss heraldic shield (royal blue & gold)
    ctx.beginPath();
    ctx.moveTo(-r * 0.74, -r * 0.82);
    ctx.lineTo(r * 0.74, -r * 0.82);
    ctx.lineTo(r * 0.74, -r * 0.05);
    ctx.quadraticCurveTo(r * 0.72, r * 0.65, 0, r * 0.96);
    ctx.quadraticCurveTo(-r * 0.72, r * 0.65, -r * 0.74, -r * 0.05);
    ctx.closePath();
    const g = ctx.createLinearGradient(-r, -r, r, r);
    g.addColorStop(0, "#2563eb");
    g.addColorStop(1, "#1e3a8a");
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = "#eab308";
    ctx.lineWidth = Math.max(1.2, r * 0.13);
    ctx.stroke();
    // Golden inner bar + star dot
    ctx.fillStyle = "#facc15";
    ctx.fillRect(-r * 0.48, -r * 0.2, r * 0.96, r * 0.18);
    ctx.beginPath();
    ctx.arc(0, r * 0.34, r * 0.15, 0, Math.PI * 2);
    ctx.fill();
  } else if (suit === "rosen") {
    // Swiss 5-petal rose with green sepals
    ctx.fillStyle = "#15803d";
    for (let i = 0; i < 5; i++) {
      const a = (i * Math.PI * 2) / 5 + Math.PI / 5 - Math.PI / 2;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(a - 0.18) * r * 0.5, Math.sin(a - 0.18) * r * 0.5);
      ctx.lineTo(Math.cos(a) * r * 0.98, Math.sin(a) * r * 0.98);
      ctx.lineTo(Math.cos(a + 0.18) * r * 0.5, Math.sin(a + 0.18) * r * 0.5);
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillStyle = "#dc2626";
    ctx.strokeStyle = "#991b1b";
    ctx.lineWidth = Math.max(0.8, r * 0.07);
    for (let i = 0; i < 5; i++) {
      const a = (i * Math.PI * 2) / 5 - Math.PI / 2;
      ctx.beginPath();
      ctx.arc(Math.cos(a) * r * 0.4, Math.sin(a) * r * 0.4, r * 0.36, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.fillStyle = "#facc15";
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.24, 0, Math.PI * 2);
    ctx.fill();
  } else if (suit === "eicheln" || suit === "eichel") {
    // Acorn (Swiss green/brown or German)
    // Stem
    ctx.strokeStyle = "#4d7c0f";
    ctx.lineWidth = Math.max(1.2, r * 0.14);
    ctx.beginPath();
    ctx.moveTo(0, -r * 0.55);
    ctx.quadraticCurveTo(r * 0.12, -r * 0.92, r * 0.34, -r * 0.88);
    ctx.stroke();
    // Nut body
    const nutGrad = ctx.createLinearGradient(-r * 0.5, 0, r * 0.5, r);
    nutGrad.addColorStop(0, suit === "eicheln" ? "#22c55e" : "#a16207");
    nutGrad.addColorStop(1, suit === "eicheln" ? "#15803d" : "#713f12");
    ctx.fillStyle = nutGrad;
    ctx.beginPath();
    ctx.moveTo(-r * 0.52, -r * 0.15);
    ctx.quadraticCurveTo(-r * 0.55, r * 0.65, 0, r * 0.95);
    ctx.quadraticCurveTo(r * 0.55, r * 0.65, r * 0.52, -r * 0.15);
    ctx.closePath();
    ctx.fill();
    // Cap
    ctx.fillStyle = "#78350f";
    ctx.beginPath();
    ctx.ellipse(0, -r * 0.22, r * 0.68, r * 0.38, 0, Math.PI, Math.PI * 2);
    ctx.lineTo(r * 0.68, -r * 0.1);
    ctx.quadraticCurveTo(0, r * 0.12, -r * 0.68, -r * 0.1);
    ctx.closePath();
    ctx.fill();
  } else if (suit === "laub") {
    // German green leaf
    ctx.fillStyle = "#16a34a";
    ctx.beginPath();
    ctx.moveTo(0, -r * 0.95);
    ctx.bezierCurveTo(r * 1.05, -r * 0.2, r * 0.85, r * 0.72, 0, r * 0.45);
    ctx.bezierCurveTo(-r * 0.85, r * 0.72, -r * 1.05, -r * 0.2, 0, -r * 0.95);
    ctx.fill();
    ctx.strokeStyle = "#14532d";
    ctx.lineWidth = Math.max(1, r * 0.1);
    ctx.beginPath();
    ctx.moveTo(0, -r * 0.65);
    ctx.lineTo(0, r * 0.92);
    ctx.stroke();
  }

  ctx.restore();
}

const PIP_LAYOUTS = {
  "2": [[0.5, 0.26], [0.5, 0.74]],
  "3": [[0.5, 0.23], [0.5, 0.5], [0.5, 0.77]],
  "4": [[0.34, 0.26], [0.66, 0.26], [0.34, 0.74], [0.66, 0.74]],
  "5": [[0.34, 0.25], [0.66, 0.25], [0.5, 0.5], [0.34, 0.75], [0.66, 0.75]],
  "6": [[0.34, 0.24], [0.66, 0.24], [0.34, 0.5], [0.66, 0.5], [0.34, 0.76], [0.66, 0.76]],
  "7": [[0.34, 0.23], [0.66, 0.23], [0.5, 0.37], [0.34, 0.52], [0.66, 0.52], [0.34, 0.77], [0.66, 0.77]],
  "8": [[0.34, 0.22], [0.66, 0.22], [0.5, 0.36], [0.34, 0.5], [0.66, 0.5], [0.5, 0.64], [0.34, 0.78], [0.66, 0.78]],
  "9": [[0.33, 0.21], [0.67, 0.21], [0.33, 0.4], [0.67, 0.4], [0.5, 0.5], [0.33, 0.6], [0.67, 0.6], [0.33, 0.79], [0.67, 0.79]],
  "10": [[0.33, 0.2], [0.67, 0.2], [0.5, 0.31], [0.33, 0.42], [0.67, 0.42], [0.33, 0.58], [0.67, 0.58], [0.5, 0.69], [0.33, 0.8], [0.67, 0.8]],
};

function drawCrown(ctx, cx, cy, r, color) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.fillStyle = color;
  ctx.strokeStyle = "#78350f";
  ctx.lineWidth = Math.max(0.8, r * 0.08);
  ctx.beginPath();
  ctx.moveTo(-r, r * 0.45);
  ctx.lineTo(-r * 0.9, -r * 0.42);
  ctx.lineTo(-r * 0.38, r * 0.02);
  ctx.lineTo(0, -r * 0.68);
  ctx.lineTo(r * 0.38, r * 0.02);
  ctx.lineTo(r * 0.9, -r * 0.42);
  ctx.lineTo(r, r * 0.45);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // Crown jewels
  for (const [jx, jy, c] of [[-r * 0.88, -r * 0.44, "#dc2626"], [0, -r * 0.7, "#2563eb"], [r * 0.88, -r * 0.44, "#dc2626"]]) {
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.arc(jx, jy, r * 0.12, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = "#fde047";
  ctx.fillRect(-r, r * 0.3, r * 2, r * 0.16);
  ctx.restore();
}

function drawDiadem(ctx, cx, cy, r, color) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.strokeStyle = "#d97706";
  ctx.lineWidth = Math.max(1, r * 0.12);
  ctx.beginPath();
  ctx.arc(0, r * 0.55, r * 0.9, Math.PI * 1.15, Math.PI * 1.85);
  ctx.stroke();
  ctx.fillStyle = color;
  for (const [px, py, pr] of [[0, -r * 0.45, 0.24], [-r * 0.45, -r * 0.2, 0.17], [r * 0.45, -r * 0.2, 0.17]]) {
    ctx.beginPath();
    ctx.arc(px, py, r * pr, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawPlumeCap(ctx, cx, cy, r, color) {
  ctx.save();
  ctx.translate(cx, cy);
  // Feather plume
  ctx.fillStyle = "#eab308";
  ctx.beginPath();
  ctx.moveTo(r * 0.15, -r * 0.1);
  ctx.quadraticCurveTo(r * 0.95, -r * 0.85, r * 0.9, -r * 0.15);
  ctx.quadraticCurveTo(r * 0.5, -r * 0.05, r * 0.15, -r * 0.1);
  ctx.fill();
  // Cap brim & crown
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(0, r * 0.12, r * 0.82, r * 0.36, -0.08, Math.PI, Math.PI * 2);
  ctx.closePath();
  ctx.fill();
  ctx.fillRect(-r * 0.85, r * 0.08, r * 1.7, r * 0.18);
  ctx.restore();
}

function drawFigureShoulders(ctx, cx, cy, bw, bh, color) {
  ctx.save();
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.22;
  ctx.beginPath();
  ctx.moveTo(cx - bw * 0.42, cy + bh * 0.34);
  ctx.quadraticCurveTo(cx - bw * 0.36, cy + bh * 0.05, cx, cy + bh * 0.02);
  ctx.quadraticCurveTo(cx + bw * 0.36, cy + bh * 0.05, cx + bw * 0.42, cy + bh * 0.34);
  ctx.closePath();
  ctx.fill();
  // Sash diagonal
  ctx.globalAlpha = 0.28;
  ctx.strokeStyle = "#d97706";
  ctx.lineWidth = Math.max(2, bw * 0.08);
  ctx.beginPath();
  ctx.moveTo(cx - bw * 0.28, cy + bh * 0.06);
  ctx.lineTo(cx + bw * 0.22, cy + bh * 0.34);
  ctx.stroke();
  ctx.restore();
}

/** Returns an offscreen canvas with the rendered card face, cached by size & deck. */
export function getCardCanvas(deckId, card, width, height, dpr = 1) {
  const pw = Math.max(24, Math.round(width * dpr));
  const ph = Math.max(36, Math.round(height * dpr));
  const key = `f:${deckId}:${card.id}:${pw}x${ph}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const meta = DECK_META[deckId] ?? DECK_META.swiss36;
  const suitInfo = meta.suits.find((s) => s.id === card.suit) ?? meta.suits[0];
  const shortRank = meta.ranks[card.rank] ?? card.rank;
  const title = meta.titles[card.rank] ?? "";

  const canvas = document.createElement("canvas");
  canvas.width = pw;
  canvas.height = ph;
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);

  const r = Math.min(width, height) * 0.09;

  if ((deckId === "french36" || deckId === "french52") && frenchDefs) {
    const fSuit = FRENCH_SUITS[card.suit];
    const fRank = FRENCH_RANKS[card.rank] ?? card.rank;
    if (fSuit) {
      const svgId = `${fSuit}_${fRank}`;
      const img = frenchCardImgs.get(svgId);
      if (img) {
        roundRectPath(ctx, 0.5, 0.5, width - 1, height - 1, r);
        ctx.save();
        ctx.clip();
        ctx.drawImage(img, 0, 0, width, height);
        ctx.restore();
        trimCache();
        cache.set(key, canvas);
        return canvas;
      }
      requestFrenchCard(svgId, key);
    }
  }

  // Card stock background
  roundRectPath(ctx, 0.5, 0.5, width - 1, height - 1, r);
  const bg = ctx.createLinearGradient(0, 0, width, height);
  bg.addColorStop(0, meta.stock);
  bg.addColorStop(1, deckId === "swiss36" ? "#f2e8d2" : "#f4f4f5");
  ctx.fillStyle = bg;
  ctx.fill();

  ctx.strokeStyle = "rgba(30, 25, 18, 0.28)";
  ctx.lineWidth = 1;
  ctx.stroke();

  // Subtle inner frame for Swiss & German cards
  if (deckId === "swiss36" || deckId === "german32") {
    roundRectPath(ctx, width * 0.06, height * 0.045, width * 0.88, height * 0.91, r * 0.6);
    ctx.strokeStyle = "rgba(161, 118, 45, 0.25)";
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // Corner indices (top-left and inverted bottom-right)
  const fontSize = Math.max(10, Math.round(width * 0.2));
  const cornerX = width * 0.16;
  const cornerY = height * 0.135;
  const drawCorner = () => {
    ctx.fillStyle = suitInfo.color;
    ctx.font = `700 ${fontSize}px system-ui, -apple-system, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(shortRank, cornerX, cornerY);
    drawSuit(ctx, card.suit, cornerX, cornerY + fontSize * 0.85, width * 0.085);
  };
  drawCorner();
  ctx.save();
  ctx.translate(width, height);
  ctx.rotate(Math.PI);
  drawCorner();
  ctx.restore();

  // Center artwork
  const cx = width * 0.5;
  const cy = height * 0.5;

  if (deckId === "swiss36" && card.rank === "10") {
    // Traditional Swiss Banner (10) diagonal heraldic sash with gold trim
    ctx.save();
    roundRectPath(ctx, width * 0.14, height * 0.11, width * 0.72, height * 0.78, r * 0.4);
    ctx.clip();
    ctx.strokeStyle = suitInfo.color;
    ctx.globalAlpha = 0.2;
    ctx.lineWidth = width * 0.24;
    ctx.beginPath();
    ctx.moveTo(-width * 0.05, height * 0.82);
    ctx.lineTo(width * 1.05, height * 0.18);
    ctx.stroke();
    ctx.strokeStyle = "#eab308";
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(-width * 0.05, height * 0.72);
    ctx.lineTo(width * 1.05, height * 0.08);
    ctx.moveTo(-width * 0.05, height * 0.92);
    ctx.lineTo(width * 1.05, height * 0.28);
    ctx.stroke();
    ctx.restore();

    drawSuit(ctx, card.suit, cx, cy - height * 0.14, width * 0.19);
    ctx.fillStyle = suitInfo.color;
    ctx.font = `800 ${Math.max(8, Math.round(width * 0.12))}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("BANNER", cx, cy + height * 0.03);
    drawSuit(ctx, card.suit, cx, cy + height * 0.19, width * 0.14);
  } else if (card.rank === "A") {
    // Ace laurel wreath medallion
    ctx.save();
    const wr = width * 0.3;
    ctx.strokeStyle = "#ca8a04";
    ctx.globalAlpha = 0.45;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, wr, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = "#ca8a04";
    for (let i = 0; i < 12; i++) {
      const a = (i * Math.PI * 2) / 12;
      ctx.beginPath();
      ctx.ellipse(cx + Math.cos(a) * wr, cy + Math.sin(a) * wr, width * 0.03, width * 0.014, a + Math.PI / 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    drawSuit(ctx, card.suit, cx, cy, width * 0.26);
  } else if (card.rank === "J" || card.rank === "Q" || card.rank === "K") {
    // Ornate double-framed court card medallion
    const bw = width * 0.58;
    const bh = height * 0.56;
    roundRectPath(ctx, cx - bw / 2, cy - bh / 2, bw, bh, r * 0.55);
    ctx.fillStyle = suitInfo.color;
    ctx.globalAlpha = 0.08;
    ctx.fill();
    ctx.globalAlpha = 0.42;
    ctx.strokeStyle = suitInfo.color;
    ctx.lineWidth = 1.4;
    ctx.stroke();
    roundRectPath(ctx, cx - bw / 2 + 3, cy - bh / 2 + 3, bw - 6, bh - 6, r * 0.42);
    ctx.strokeStyle = "#ca8a04";
    ctx.globalAlpha = 0.45;
    ctx.lineWidth = 0.9;
    ctx.stroke();
    ctx.globalAlpha = 1;

    drawFigureShoulders(ctx, cx, cy, bw, bh, suitInfo.color);

    if (card.rank === "K") {
      drawCrown(ctx, cx, cy - bh * 0.24, width * 0.15, "#d97706");
    } else if (card.rank === "Q") {
      drawDiadem(ctx, cx, cy - bh * 0.24, width * 0.14, suitInfo.color);
    } else {
      drawPlumeCap(ctx, cx, cy - bh * 0.24, width * 0.14, suitInfo.color);
    }

    drawSuit(ctx, card.suit, cx, cy + bh * 0.06, width * 0.18);

    if (title) {
      // Banner pill for court title
      ctx.fillStyle = "rgba(255, 255, 255, 0.86)";
      roundRectPath(ctx, cx - bw * 0.4, cy + bh * 0.26, bw * 0.8, bh * 0.18, 4);
      ctx.fill();
      ctx.fillStyle = suitInfo.color;
      ctx.font = `800 ${Math.max(7, Math.round(width * 0.105))}px system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(title, cx, cy + bh * 0.355);
    }
  } else {
    // Number card pips
    const pips = PIP_LAYOUTS[card.rank] ?? [[0.5, 0.5]];
    const pipR = width * (pips.length > 7 ? 0.095 : 0.11);
    for (const [px, py] of pips) {
      drawSuit(ctx, card.suit, width * px, height * py, pipR);
    }
  }

  trimCache();
  cache.set(key, canvas);
  return canvas;
}

/** Returns an offscreen canvas with the rendered card back, cached by size & deck. */
export function getCardBackCanvas(deckId, width, height, dpr = 1) {
  const pw = Math.max(20, Math.round(width * dpr));
  const ph = Math.max(28, Math.round(height * dpr));
  const key = `b:${deckId}:${pw}x${ph}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const meta = DECK_META[deckId] ?? DECK_META.swiss36;
  const canvas = document.createElement("canvas");
  canvas.width = pw;
  canvas.height = ph;
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);

  const r = Math.min(width, height) * 0.09;
  if ((deckId === "french36" || deckId === "french52") && frenchDefs) {
    const img = frenchCardImgs.get("back");
    if (img) {
      roundRectPath(ctx, 0.5, 0.5, width - 1, height - 1, r);
      ctx.save();
      ctx.clip();
      ctx.drawImage(img, 0, 0, width, height);
      ctx.restore();
      trimCache();
      cache.set(key, canvas);
      return canvas;
    }
    requestFrenchCard("back", key);
  }

  roundRectPath(ctx, 0.5, 0.5, width - 1, height - 1, r);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.28)";
  ctx.lineWidth = 1;
  ctx.stroke();

  const pad = width * 0.075;
  roundRectPath(ctx, pad, pad, width - pad * 2, height - pad * 2, r * 0.55);
  ctx.fillStyle = meta.back;
  ctx.fill();

  // Subtle geometric lattice
  ctx.save();
  ctx.clip();
  ctx.strokeStyle = "rgba(255,255,255,0.16)";
  ctx.lineWidth = 1;
  const step = Math.max(6, width * 0.14);
  for (let x = -height; x < width + height; x += step) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + height, height);
    ctx.moveTo(x + height, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  ctx.restore();

  // Center emblem (Swiss cross for swiss36, diamond for others)
  const cx = width / 2;
  const cy = height / 2;
  const er = width * 0.16;
  ctx.fillStyle = "rgba(255,255,255,0.88)";
  if (deckId === "swiss36") {
    ctx.fillRect(cx - er * 0.3, cy - er * 0.85, er * 0.6, er * 1.7);
    ctx.fillRect(cx - er * 0.85, cy - er * 0.3, er * 1.7, er * 0.6);
  } else {
    ctx.beginPath();
    ctx.moveTo(cx, cy - er);
    ctx.lineTo(cx + er * 0.72, cy);
    ctx.lineTo(cx, cy + er);
    ctx.lineTo(cx - er * 0.72, cy);
    ctx.closePath();
    ctx.fill();
  }

  trimCache();
  cache.set(key, canvas);
  return canvas;
}
