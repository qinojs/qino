import { getCardBackCanvas, getCardCanvas, loadDeckAssets } from "./cards.js";

function canPlayTschau(card, top, wishSuit, pendingDraw) {
  if (pendingDraw > 0) return card.rank === "7";
  if (!top) return true;
  if (card.rank === "J") return true;
  return card.suit === (wishSuit || top.suit) || card.rank === top.rank;
}

let audioCtx = null;
function unlockAudio() {
  try {
    const Ctx = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!Ctx) return null;
    audioCtx ??= new Ctx();
    if (audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
    return audioCtx;
  } catch {
    return null;
  }
}

function playNoise(gainVal, duration, cutoff = 1100, delay = 0) {
  const ac = unlockAudio();
  if (!ac || ac.state !== "running") return;
  const t0 = ac.currentTime + delay;
  const len = Math.max(1, Math.floor(ac.sampleRate * duration));
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = ac.createBufferSource();
  src.buffer = buf;
  const filter = ac.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = cutoff;
  const gain = ac.createGain();
  gain.gain.setValueAtTime(gainVal, t0);
  gain.gain.exponentialRampToValueAtTime(0.0005, t0 + duration);
  src.connect(filter).connect(gain).connect(ac.destination);
  src.start(t0);
}

const soundCard = () => playNoise(0.035, 0.065, 950);
const soundDeal = () => {
  playNoise(0.022, 0.045, 1300, 0);
  playNoise(0.022, 0.045, 1450, 0.055);
  playNoise(0.022, 0.045, 1600, 0.11);
};
const soundTrick = () => playNoise(0.028, 0.09, 720);

/** Interactive High-DPI Canvas card table with spring animations and mobile touch gestures. */
export class CardTableCanvas {
  #canvas;
  #ctx;
  #onPlay;
  #onDraw;
  #onTake;
  #showCounts;
  #state = null;
  #width = 0;
  #height = 0;
  #dpr = 1;
  #feltCanvas = null;
  #handRects = [];
  #drawRect = null;
  #pileRect = null;
  #seatPos = new Map();
  #trickAnim = null;
  #selectedId = null;
  #hoverId = null;
  #drag = null;
  #raf = 0;
  #animStart = new Map();
  #resizeObserver = null;

  constructor(canvas, { onPlay, onDraw, onTake, showCounts = true }) {
    this.#canvas = canvas;
    this.#ctx = canvas.getContext("2d");
    this.#onPlay = onPlay;
    this.#onDraw = onDraw;
    this.#onTake = onTake;
    this.#showCounts = showCounts;

    this.#bindEvents();
    this.#resizeObserver = new ResizeObserver(() => this.resize());
    this.#resizeObserver.observe(canvas.parentElement ?? canvas);
    this.resize();
  }

  destroy() {
    if (this.#raf) cancelAnimationFrame(this.#raf);
    this.#resizeObserver?.disconnect();
  }

  setState(state) {
    const prevPileLen = this.#state?.pile?.length ?? 0;
    const prevRound = this.#state?.round ?? 0;
    const prevLast = this.#state?.lastTrick;
    this.#state = state;
    loadDeckAssets(state.deck || "swiss36", () => this.#schedule());

    const now = performance.now();
    if (state.round !== prevRound && state.round > 0) {
      this.#selectedId = null;
      this.#animStart.set("deal", now);
      soundDeal();
    }
    if (state.pile.length > prevPileLen) {
      for (let i = prevPileLen; i < state.pile.length; i++) {
        const entry = state.pile[i];
        if (entry) this.#animStart.set(`pile:${entry.card.id}:${i}`, { start: now, fromId: entry.playerId });
      }
      soundCard();
    }
    if (prevPileLen > 0 && state.pile.length === 0 && state.lastTrick && state.lastTrick !== prevLast) {
      this.#trickAnim = { start: now, toId: state.lastTrick.winnerId };
      soundTrick();
    }
    if (this.#selectedId && !state.me?.hand?.some((c) => c.id === this.#selectedId)) {
      this.#selectedId = null;
    }
    this.#schedule();
  }

  resize() {
    const parent = this.#canvas.parentElement ?? this.#canvas;
    const rect = parent.getBoundingClientRect();
    const w = Math.max(260, Math.floor(rect.width));
    const h = Math.max(280, Math.floor(rect.height));
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    if (w === this.#width && h === this.#height && dpr === this.#dpr) return;

    this.#width = w;
    this.#height = h;
    this.#dpr = dpr;
    this.#canvas.width = Math.round(w * dpr);
    this.#canvas.height = Math.round(h * dpr);
    this.#feltCanvas = null;
    this.#schedule();
  }

  #schedule() {
    if (!this.#raf) this.#raf = requestAnimationFrame((t) => this.#frame(t));
  }

  #buildFelt() {
    const c = document.createElement("canvas");
    c.width = Math.round(this.#width * this.#dpr);
    c.height = Math.round(this.#height * this.#dpr);
    const ctx = c.getContext("2d");
    ctx.scale(this.#dpr, this.#dpr);
    const w = this.#width;
    const h = this.#height;

    // Layered walnut wooden table rail
    const rail = ctx.createLinearGradient(0, 0, w, h);
    rail.addColorStop(0, "#3b2316");
    rail.addColorStop(0.5, "#26150c");
    rail.addColorStop(1, "#351f13");
    ctx.fillStyle = rail;
    ctx.fillRect(0, 0, w, h);

    // Recessed Jass-Teppich felt surface
    const rim = Math.max(7, Math.min(w, h) * 0.022);
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(rim, rim, w - rim * 2, h - rim * 2, 16);
    ctx.clip();

    const grad = ctx.createRadialGradient(w * 0.5, h * 0.42, Math.min(w, h) * 0.05, w * 0.5, h * 0.45, Math.max(w, h) * 0.72);
    grad.addColorStop(0, "#1f6e43");
    grad.addColorStop(0.6, "#165232");
    grad.addColorStop(1, "#0d3520");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // Subtle woven felt texture (deterministic speckles)
    ctx.fillStyle = "rgba(255,255,255,0.025)";
    for (let i = 0; i < 900; i++) {
      const x = ((i * 73.13) % 1) * w;
      const y = ((i * 41.77 + Math.sin(i) * 0.5 + 0.5) % 1) * h;
      ctx.fillRect(x, y, 1.5, 1.5);
    }

    // Traditional Jass-Teppich golden stitched border
    const inset = rim + 10;
    ctx.strokeStyle = "rgba(234, 179, 8, 0.24)";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.roundRect(inset, inset, w - inset * 2, h - inset * 2, 12);
    ctx.stroke();
    ctx.setLineDash([]);

    // Center play zone ring
    const centerY = h * 0.44;
    const zoneR = Math.min(w, h) * 0.22;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.1)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(w * 0.5, centerY, zoneR, 0, Math.PI * 2);
    ctx.stroke();

    ctx.restore();

    // Inner rail bevel & shadow onto felt
    ctx.strokeStyle = "rgba(255, 215, 160, 0.14)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(rim - 1, rim - 1, w - (rim - 1) * 2, h - (rim - 1) * 2, 17);
    ctx.stroke();

    ctx.strokeStyle = "rgba(0,0,0,0.55)";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.roundRect(rim, rim, w - rim * 2, h - rim * 2, 16);
    ctx.stroke();

    this.#feltCanvas = c;
  }

  #cardSize() {
    const base = Math.min(this.#width * 0.24, this.#height * 0.31, 165);
    const w = Math.max(68, Math.round(base));
    return { w, h: Math.round(w * 1.48) };
  }

  #frame(now) {
    this.#raf = 0;
    if (!this.#feltCanvas) this.#buildFelt();

    const ctx = this.#ctx;
    ctx.save();
    ctx.scale(this.#dpr, this.#dpr);
    ctx.drawImage(this.#feltCanvas, 0, 0, this.#width, this.#height);

    const state = this.#state;
    if (!state) {
      ctx.restore();
      return;
    }

    let needsMore = false;
    const deckId = state.deck || "swiss36";
    const { w: cw, h: ch } = this.#cardSize();

    this.#drawOpponents(ctx, state, deckId);
    needsMore = this.#drawCenter(ctx, state, deckId, cw, ch, now) || needsMore;
    needsMore = this.#drawHand(ctx, state, deckId, cw, ch, now) || needsMore;
    this.#drawStatusPill(ctx, state);

    ctx.restore();
    if (needsMore || this.#drag) this.#schedule();
  }

  #drawOpponents(ctx, state, deckId) {
    const players = state.players ?? [];
    const mySeat = state.me?.seat ?? 0;
    this.#seatPos.clear();
    if (state.me?.id) this.#seatPos.set(state.me.id, { x: this.#width * 0.5, y: this.#height * 0.86 });

    const others = [];
    for (let i = 1; i < players.length; i++) {
      others.push(players[(mySeat + i) % players.length]);
    }
    if (!others.length) return;

    const w = this.#width;
    const h = this.#height;
    const backW = Math.max(18, Math.round(w * 0.038));
    const backH = Math.round(backW * 1.45);
    const backImg = getCardBackCanvas(deckId, backW, backH, this.#dpr);

    others.forEach((p, idx) => {
      const frac = others.length === 1 ? 0.5 : (idx + 0.5) / others.length;
      const angle = Math.PI * (0.18 + frac * 0.64);
      const sx = w * 0.5 - Math.cos(angle) * (w * 0.36);
      const sy = Math.max(56, h * 0.15 - Math.sin(angle) * (h * 0.03));
      this.#seatPos.set(p.id, { x: sx, y: sy });

      const isTurn = state.turnPlayerId === p.id && state.round > 0 && !state.trickComplete && !state.winnerId;

      // Mini card backs fan showing card count
      if (this.#showCounts && p.cardCount > 0) {
        const shown = Math.min(p.cardCount, 9);
        const spread = Math.min(10, 56 / shown);
        for (let c = 0; c < shown; c++) {
          const offset = (c - (shown - 1) / 2) * spread;
          ctx.save();
          ctx.translate(sx + offset, sy + 20);
          ctx.rotate((c - (shown - 1) / 2) * 0.07);
          ctx.drawImage(backImg, -backW / 2, -backH / 2, backW, backH);
          ctx.restore();
        }
      }

      // Seat badge
      const label = state.mode === "jass" && state.round > 0
        ? `${p.name} · ${p.points} P.`
        : `${p.name}${this.#showCounts ? ` (${p.cardCount})` : ""}`;
      ctx.font = "600 12px system-ui, -apple-system, sans-serif";
      const tw = ctx.measureText(label).width;
      const bw = tw + 18;
      const bh = 24;

      ctx.save();
      ctx.beginPath();
      ctx.roundRect(sx - bw / 2, sy - bh / 2, bw, bh, 12);
      ctx.fillStyle = isTurn ? "rgba(234, 179, 8, 0.92)" : "rgba(10, 22, 16, 0.72)";
      ctx.fill();
      ctx.strokeStyle = isTurn ? "#fef08a" : "rgba(255,255,255,0.22)";
      ctx.lineWidth = isTurn ? 2 : 1;
      ctx.stroke();

      ctx.fillStyle = isTurn ? "#1c1917" : "#f8fafc";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(label, sx, sy + 0.5);
      ctx.restore();
    });
  }

  #drawCenter(ctx, state, deckId, cw, ch, now) {
    let animating = false;
    const cx = this.#width * 0.5;
    const cy = this.#height * 0.43;
    const pile = state.pile ?? [];
    const pileW = Math.round(cw * 0.94);
    const pileH = Math.round(ch * 0.94);

    // Draw pile (Nachziehstapel) when undealt cards exist
    this.#drawRect = null;
    if (state.drawCount > 0) {
      const dx = state.mode !== "jass" ? cx - pileW * 0.92 : Math.max(pileW * 0.72, cx - pileW * 1.45);
      const dy = cy;
      const back = getCardBackCanvas(deckId, pileW, pileH, this.#dpr);
      const layers = Math.min(4, Math.ceil(state.drawCount / 6));
      for (let i = 0; i < layers; i++) {
        ctx.save();
        ctx.shadowColor = "rgba(0,0,0,0.35)";
        ctx.shadowBlur = 8;
        ctx.shadowOffsetY = 3;
        ctx.drawImage(back, dx - pileW / 2 - i * 1.5, dy - pileH / 2 - i * 1.5, pileW, pileH);
        ctx.restore();
      }
      // Draw-pile action pill
      const drawLabel = state.pendingDraw > 0 ? `+${state.pendingDraw} ziehen` : `Ziehen (${state.drawCount})`;
      ctx.save();
      ctx.font = "700 11px system-ui, sans-serif";
      const pw = Math.max(58, ctx.measureText(drawLabel).width + 16);
      ctx.fillStyle = state.pendingDraw > 0 ? "rgba(220, 38, 38, 0.94)" : "rgba(15, 23, 42, 0.85)";
      ctx.beginPath();
      ctx.roundRect(dx - pw / 2, dy + pileH / 2 - 12, pw, 20, 10);
      ctx.fill();
      ctx.fillStyle = "#f8fafc";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(drawLabel, dx, dy + pileH / 2 - 2);
      ctx.restore();
      this.#drawRect = { x: dx - pileW / 2, y: dy - pileH / 2, w: pileW, h: pileH };
    }

    // Highlight center drop zone while dragging a card upward
    if (this.#drag && this.#drag.moved && this.#drag.y < this.#height * 0.64) {
      ctx.save();
      ctx.strokeStyle = "rgba(250, 204, 21, 0.6)";
      ctx.fillStyle = "rgba(250, 204, 21, 0.08)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, this.#height * 0.44, Math.min(this.#width, this.#height) * 0.22, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

    // Center table pile / current trick
    const pileCx = state.mode !== "jass" && state.drawCount > 0 ? cx + pileW * 0.42 : cx;
    this.#pileRect = { x: pileCx - pileW * 0.85, y: cy - pileH * 0.75, w: pileW * 1.7, h: pileH * 1.5 };

    // Flying collected trick animation toward winner's seat
    if (this.#trickAnim && !pile.length) {
      const p = Math.min(1, (now - this.#trickAnim.start) / 300);
      if (p < 1) {
        animating = true;
        const ease = 1 - (1 - p) ** 3;
        const target = this.#seatPos.get(this.#trickAnim.toId) ?? { x: cx, y: cy };
        const back = getCardBackCanvas(deckId, pileW * 0.72, pileH * 0.72, this.#dpr);
        const fx = pileCx + (target.x - pileCx) * ease;
        const fy = cy + (target.y - cy) * ease;
        ctx.save();
        ctx.globalAlpha = 1 - p * 0.4;
        ctx.translate(fx, fy);
        ctx.scale(1 - p * 0.45, 1 - p * 0.45);
        ctx.drawImage(back, -pileW * 0.36, -pileH * 0.36, pileW * 0.72, pileH * 0.72);
        ctx.restore();
      } else {
        this.#trickAnim = null;
      }
    }

    if (!pile.length) {
      ctx.save();
      ctx.fillStyle = "rgba(255,255,255,0.45)";
      ctx.font = "600 13px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const hint = state.round === 0
        ? "Tippe unten auf «Geben»"
        : state.lastTrick
        ? `Stich an ${state.lastTrick.winnerName} (+${state.lastTrick.points} P.)`
        : "Karte hochziehen zum Spielen";
      ctx.fillText(hint, pileCx, cy);
      ctx.restore();
      return animating;
    }

    // Show up to the last 5 cards on the pile (or full trick in Jass)
    const offsetBase = state.mode === "jass" ? 0 : Math.max(0, pile.length - 5);
    const visible = state.mode === "jass" ? pile : pile.slice(-5);
    visible.forEach((entry, idx) => {
      const isTop = idx === visible.length - 1;
      const animMeta = this.#animStart.get(`pile:${entry.card.id}:${offsetBase + idx}`);
      const p = animMeta ? Math.min(1, (now - animMeta.start) / 260) : 1;
      if (p < 1) animating = true;
      const ease = 1 - (1 - p) ** 3;

      const spreadX = state.mode === "jass"
        ? (idx - (visible.length - 1) / 2) * (pileW * 0.42) + entry.x * pileW * 0.35
        : entry.x * pileW * 0.35;
      const spreadY = entry.y * pileH * 0.25;
      const destX = pileCx + spreadX;
      const destY = cy + spreadY;
      const origin = animMeta ? (this.#seatPos.get(animMeta.fromId) ?? { x: pileCx, y: cy + 50 }) : { x: destX, y: destY };
      const tx = origin.x + (destX - origin.x) * ease;
      const ty = origin.y + (destY - origin.y) * ease;

      const img = getCardCanvas(deckId, entry.card, pileW, pileH, this.#dpr);
      ctx.save();
      ctx.translate(tx, ty);
      ctx.rotate(entry.rot * ease);
      ctx.shadowColor = isTop ? "rgba(0,0,0,0.46)" : "rgba(0,0,0,0.28)";
      ctx.shadowBlur = isTop ? 16 : 8;
      ctx.shadowOffsetY = isTop ? 6 : 3;
      ctx.drawImage(img, -pileW / 2, -pileH / 2, pileW, pileH);

      if (isTop && state.trickComplete) {
        ctx.strokeStyle = "#facc15";
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.roundRect(-pileW / 2, -pileH / 2, pileW, pileH, pileW * 0.09);
        ctx.stroke();
      }
      ctx.restore();
    });

    // Subtle label showing who played the top card (or trick complete prompt)
    const top = pile.at(-1);
    if (top) {
      const text = state.trickComplete
        ? "Stich fertig — tippen zum Nehmen"
        : `${top.playerName}`;
      ctx.save();
      ctx.font = "600 11px system-ui, sans-serif";
      const tw = ctx.measureText(text).width + 16;
      ctx.fillStyle = state.trickComplete ? "rgba(234, 179, 8, 0.92)" : "rgba(10, 22, 16, 0.65)";
      ctx.beginPath();
      ctx.roundRect(pileCx - tw / 2, cy + pileH * 0.56, tw, 20, 10);
      ctx.fill();
      ctx.fillStyle = state.trickComplete ? "#1c1917" : "#e2e8f0";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(text, pileCx, cy + pileH * 0.56 + 10);
      ctx.restore();
    }

    return animating;
  }

  #drawStatusPill(ctx, state) {
    if (state.round <= 0) return;
    let statusMsg = state.banner || "";
    let highlight = Boolean(state.banner);
    if (state.trickComplete) {
      statusMsg = "Stich fertig — tippe auf den Stapel";
      highlight = true;
    } else if (!statusMsg && (state.mode === "jass" || state.mode === "tschau") && state.turnPlayerId === state.me?.id) {
      statusMsg = state.pendingDraw > 0
        ? `7er legen oder +${state.pendingDraw} ziehen!`
        : "Du bist dran — Karte antippen oder hochziehen";
      highlight = true;
    } else if (!statusMsg && state.mode === "free") {
      statusMsg = "Oben auf dem Stapel — Karte spielen oder ziehen";
    }
    if (!statusMsg) return;

    const cx = this.#width * 0.5;
    ctx.save();
    ctx.font = "600 12px system-ui, sans-serif";
    const tw = Math.min(this.#width - 28, ctx.measureText(statusMsg).width + 24);
    const py = 14;
    ctx.shadowColor = "rgba(0, 0, 0, 0.35)";
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 2;
    ctx.fillStyle = highlight ? "rgba(234, 179, 8, 0.95)" : "rgba(10, 22, 16, 0.8)";
    ctx.beginPath();
    ctx.roundRect(cx - tw / 2, py, tw, 24, 12);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
    ctx.fillStyle = highlight ? "#1c1917" : "#f8fafc";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(statusMsg, cx, py + 12.5, tw - 16);
    ctx.restore();
  }

  #drawHand(ctx, state, deckId, cw, ch, now) {
    const hand = state.me?.hand ?? [];
    this.#handRects = [];
    if (!hand.length) return false;

    const dealStart = this.#animStart.get("deal") ?? 0;
    const dealElapsed = dealStart ? now - dealStart : 9999;
    let animating = dealElapsed < 520;

    const w = this.#width;
    const h = this.#height;
    const count = hand.length;
    const maxSpan = Math.min(w - cw * 1.05, count * cw * 0.62);
    const step = count > 1 ? maxSpan / (count - 1) : 0;
    const baseY = h - ch * 0.44;
    const maxAngle = Math.min(0.28, count * 0.032);

    hand.forEach((card, i) => {
      const t = count > 1 ? i / (count - 1) - 0.5 : 0;
      const dealP = Math.min(1, Math.max(0, (dealElapsed - i * 28) / 240));
      const ease = 1 - (1 - dealP) ** 3;
      if (dealP < 1) animating = true;

      let x = w * 0.5 + (i - (count - 1) / 2) * step;
      let y = baseY + Math.abs(t) * Math.abs(t) * 34;
      let rot = t * maxAngle * 2;
      let scale = 1;

      const isDragging = this.#drag?.cardId === card.id;
      const isSelected = this.#selectedId === card.id;
      const isHover = this.#hoverId === card.id;

      if (isDragging) {
        x = this.#drag.x;
        y = this.#drag.y;
        rot = Math.max(-0.25, Math.min(0.25, (this.#drag.x - this.#drag.startX) * 0.002));
        scale = 1.08;
      } else if (isSelected) {
        y -= ch * 0.24;
        scale = 1.06;
      } else if (isHover) {
        y -= ch * 0.11;
      }

      // Deal-in animation from table center
      if (ease < 1) {
        x = w * 0.5 + (x - w * 0.5) * ease;
        y = h * 0.43 + (y - h * 0.43) * ease;
        rot *= ease;
      }

      this.#handRects.push({ card, x, y, w: cw * scale, h: ch * scale, rot });

      const img = getCardCanvas(deckId, card, cw, ch, this.#dpr);
      const isTschauTurn = state.mode === "tschau" && state.round > 0 && state.turnPlayerId === state.me?.id && !state.winnerId;
      const playable = !isTschauTurn || canPlayTschau(card, state.pile.at(-1)?.card, state.wishSuit, state.pendingDraw);

      ctx.save();
      if (!playable) ctx.globalAlpha = 0.62;
      ctx.translate(x, y);
      ctx.rotate(rot);
      ctx.scale(scale, scale);
      ctx.shadowColor = isDragging || isSelected ? "rgba(0,0,0,0.52)" : "rgba(0,0,0,0.34)";
      ctx.shadowBlur = isDragging || isSelected ? 20 : 10;
      ctx.shadowOffsetY = isDragging || isSelected ? 10 : 4;
      ctx.drawImage(img, -cw / 2, -ch / 2, cw, ch);

      if (isSelected && !isDragging) {
        ctx.strokeStyle = "#facc15";
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.roundRect(-cw / 2, -ch / 2, cw, ch, cw * 0.09);
        ctx.stroke();

        // Hint pill above lifted card
        const hint = "Nochmal tippen";
        ctx.font = "700 10px system-ui, sans-serif";
        const htw = ctx.measureText(hint).width + 12;
        ctx.fillStyle = "rgba(234, 179, 8, 0.96)";
        ctx.beginPath();
        ctx.roundRect(-htw / 2, -ch / 2 - 22, htw, 17, 8);
        ctx.fill();
        ctx.fillStyle = "#1c1917";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(hint, 0, -ch / 2 - 13);
      }
      ctx.restore();
    });

    // Own score badge at bottom-left in Jass mode
    if (state.mode === "jass" && state.me && state.round > 0) {
      const mePlayer = state.players.find((p) => p.id === state.me.id);
      if (mePlayer) {
        const isMyTurn = state.turnPlayerId === mePlayer.id && !state.trickComplete;
        const text = `${mePlayer.name} · ${mePlayer.points} P.`;
        ctx.save();
        ctx.font = "700 12px system-ui, sans-serif";
        const tw = ctx.measureText(text).width + 18;
        ctx.fillStyle = isMyTurn ? "rgba(234, 179, 8, 0.95)" : "rgba(10, 22, 16, 0.72)";
        ctx.beginPath();
        ctx.roundRect(16, h - 38, tw, 24, 12);
        ctx.fill();
        ctx.fillStyle = isMyTurn ? "#1c1917" : "#f8fafc";
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillText(text, 25, h - 26);
        ctx.restore();
      }
    }

    return animating;
  }

  #point(e) {
    const rect = this.#canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  #hitHand(px, py) {
    // Check top-most (right-most) card first
    for (let i = this.#handRects.length - 1; i >= 0; i--) {
      const r = this.#handRects[i];
      const dx = px - r.x;
      const dy = py - r.y;
      const cos = Math.cos(-r.rot);
      const sin = Math.sin(-r.rot);
      const lx = dx * cos - dy * sin;
      const ly = dx * sin + dy * cos;
      if (Math.abs(lx) <= r.w / 2 && Math.abs(ly) <= r.h / 2) return r;
    }
    return null;
  }

  #inRect(px, py, r) {
    return Boolean(r && px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h);
  }

  #bindEvents() {
    this.#canvas.addEventListener("pointerdown", (e) => {
      unlockAudio();
      const { x, y } = this.#point(e);
      const hit = this.#hitHand(x, y);
      if (hit) {
        this.#canvas.setPointerCapture(e.pointerId);
        this.#drag = {
          pointerId: e.pointerId,
          cardId: hit.card.id,
          startX: x,
          startY: y,
          x: hit.x,
          y: hit.y,
          offsetX: hit.x - x,
          offsetY: hit.y - y,
          moved: false,
        };
        this.#schedule();
        return;
      }
      if (this.#inRect(x, y, this.#drawRect)) {
        this.#onDraw?.();
        return;
      }
      if (this.#state?.trickComplete && this.#inRect(x, y, this.#pileRect)) {
        this.#onTake?.();
        return;
      }
      if (this.#selectedId) {
        this.#selectedId = null;
        this.#schedule();
      }
    });

    this.#canvas.addEventListener("pointermove", (e) => {
      const { x, y } = this.#point(e);
      if (this.#drag && this.#drag.pointerId === e.pointerId) {
        if (Math.hypot(x - this.#drag.startX, y - this.#drag.startY) > 8) this.#drag.moved = true;
        this.#drag.x = x + this.#drag.offsetX;
        this.#drag.y = y + this.#drag.offsetY;
        this.#schedule();
        return;
      }
      if (e.pointerType === "mouse") {
        const hit = this.#hitHand(x, y);
        const next = hit?.card.id ?? null;
        if (next !== this.#hoverId) {
          this.#hoverId = next;
          this.#canvas.style.cursor = next || this.#inRect(x, y, this.#drawRect) ? "pointer" : "default";
          this.#schedule();
        }
      }
    });

    const finishDrag = (e) => {
      if (!this.#drag || this.#drag.pointerId !== e.pointerId) return;
      const drag = this.#drag;
      this.#drag = null;

      const thrownUp = drag.moved && drag.y < this.#height * 0.64;
      if (thrownUp) {
        this.#selectedId = null;
        navigator.vibrate?.(12);
        this.#onPlay?.(drag.cardId);
      } else if (!drag.moved) {
        if (this.#selectedId === drag.cardId) {
          this.#selectedId = null;
          navigator.vibrate?.(12);
          this.#onPlay?.(drag.cardId);
        } else {
          this.#selectedId = drag.cardId;
          navigator.vibrate?.(6);
        }
      }
      this.#schedule();
    };

    this.#canvas.addEventListener("pointerup", finishDrag);
    this.#canvas.addEventListener("pointercancel", finishDrag);
  }
}
