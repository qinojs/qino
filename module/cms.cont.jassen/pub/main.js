import { api } from "@qino/pub/api.js";
import { initNode } from "@qino/m/cms/pub/js/cms.js";

import { DECK_META } from "./cards.js";
import { CardTableCanvas } from "./table.js";

const NAME_STORAGE_KEY = "qino.jassen.name";
const jassApi = api["cms.cont.jassen"];

function apiBase() {
  return new URL("api/cms.cont.jassen/", location.origin + (globalThis.qino?.appUrl ?? "/"));
}

function getPosition(timeout = 8000) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error("Geolocation unavailable"));
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      (err) => reject(err),
      { enableHighAccuracy: true, timeout, maximumAge: 60000 },
    );
  });
}

async function silentPosition() {
  try {
    if (!navigator.permissions || !navigator.geolocation) return null;
    const perm = await navigator.permissions.query({ name: "geolocation" });
    if (perm.state !== "granted") return null;
    return await getPosition(4000);
  } catch {
    return null;
  }
}

function formatDistance(meters) {
  if (meters == null) return "";
  if (meters < 1000) return `~${Math.max(5, Math.round(meters / 5) * 5)} m`;
  return `~${(meters / 1000).toFixed(1)} km`;
}

initNode("cont.jassen", (box, { signal }) => {
  const nodeId = Number(box.dataset.nodeId || 0);
  const radius = Number(box.dataset.radius || 2000);
  const showCounts = box.dataset.showCounts !== "0";

  const lobby = box.querySelector(".-lobby");
  const stage = box.querySelector(".-stage");
  const nameInput = box.querySelector(".-name");
  const deckPick = box.querySelector(".-deck-pick");
  const modePick = box.querySelector(".-mode-pick");
  const createBtn = box.querySelector(".-create");
  const nearbyBtn = box.querySelector(".-nearby");
  const joinForm = box.querySelector(".-join-form");
  const codeInput = box.querySelector(".-code-input");
  const nearbyBox = box.querySelector(".-nearby-box");
  const nearbyList = box.querySelector(".-nearby-list");
  const statusEl = box.querySelector(".-status");

  const tableCodeEl = box.querySelector(".-table-code");
  const pinBtn = box.querySelector(".-pin");
  const trumpBtn = box.querySelector(".-trump-btn");
  const fsBtn = box.querySelector(".-fullscreen");
  const leaveBtn = box.querySelector(".-leave");
  const canvasEl = box.querySelector(".-canvas");
  const overlay = box.querySelector(".-overlay");
  const overlayTitle = box.querySelector(".-overlay-title");
  const overlayPlayers = box.querySelector(".-overlay-players");
  const quickStartBtn = box.querySelector(".-quick-start");
  const overlayDealBtn = box.querySelector(".-overlay-deal");
  const overlayShareBtn = box.querySelector(".-overlay-share");
  const overlayPinBtn = box.querySelector(".-overlay-pin");
  const toastEl = box.querySelector(".-toast");
  const trumpDialog = box.querySelector(".-trump-dialog");
  const trumpDialogTitle = trumpDialog.querySelector("h3");
  const trumpGrid = box.querySelector(".-trump-grid");

  // Restore optional pseudonym from localStorage if session had none
  try {
    if (!nameInput.value) {
      const saved = localStorage.getItem(NAME_STORAGE_KEY);
      if (saved) nameInput.value = saved;
    }
  } catch { /* ignore storage errors */ }

  let state = null;
  let stream = null;
  let reconnectTimer = 0;
  let wakeLock = null;
  let toastTimer = 0;
  let fakeFullscreen = false;

  const setStatus = (msg) => { statusEl.textContent = msg; };
  const toast = (msg) => {
    clearTimeout(toastTimer);
    toastEl.textContent = msg;
    toastEl.hidden = false;
    toastTimer = setTimeout(() => { toastEl.hidden = true; }, 2600);
  };

  const currentName = () => {
    const val = nameInput.value.trim().slice(0, 24);
    try { if (val) localStorage.setItem(NAME_STORAGE_KEY, val); } catch { /* ignore */ }
    return val;
  };

  const run = async (payload) => {
    const res = await jassApi.action.post({ nodeId, name: currentName(), ...payload });
    if (res?.table) applyState(res.table);
    return res;
  };

  const tableCanvas = new CardTableCanvas(canvasEl, {
    showCounts,
    onPlay: (cardId) => {
      if (!state) return;
      if (state.mode === "tschau" && state.pendingDraw === 0 && cardId.endsWith(":J")) {
        openSuitDialog("Farbe wünschen", (suitId) => {
          run({ op: "play", code: state.code, cardId, wishSuit: suitId }).catch((e) => toast(e?.message || String(e)));
        });
        return;
      }
      run({ op: "play", code: state.code, cardId }).catch((e) => toast(e?.message || String(e)));
    },
    onDraw: () => {
      if (!state) return;
      run({ op: "draw", code: state.code }).catch((e) => toast(e?.message || String(e)));
    },
    onTake: () => {
      if (!state) return;
      run({ op: "takePile", code: state.code }).catch((e) => toast(e?.message || String(e)));
    },
  });

  function openSuitDialog(title, onPick, includeJassModes = false) {
    if (!state) return;
    const meta = DECK_META[state.deck] ?? DECK_META.swiss36;
    trumpDialogTitle.textContent = title;
    trumpGrid.innerHTML = "";
    const choices = [
      ...meta.suits.map((s) => ({ id: s.id, label: s.name })),
      ...(includeJassModes ? [{ id: "obe", label: "↑ Obenabe" }, { id: "unde", label: "↓ Undeufe" }, { id: "", label: "Kein Trumpf" }] : []),
    ];
    for (const c of choices) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = c.label;
      btn.addEventListener("click", () => {
        trumpDialog.close();
        onPick(c.id);
      });
      trumpGrid.append(btn);
    }
    trumpDialog.showModal();
  }

  function closeStream() {
    clearTimeout(reconnectTimer);
    reconnectTimer = 0;
    if (stream) {
      stream.close();
      stream = null;
    }
  }

  function openStream(code) {
    closeStream();
    const url = new URL("stream", apiBase());
    url.searchParams.set("code", code);
    const es = new EventSource(url.href, { withCredentials: true });
    es.onmessage = (e) => {
      try { applyState(JSON.parse(e.data)); } catch { /* ignore */ }
    };
    es.onerror = () => {
      if (es.readyState === EventSource.CLOSED && state?.code === code) {
        clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(() => {
          if (state?.code === code) openStream(code);
        }, 2000);
      }
    };
    stream = es;
  }

  function applyState(next) {
    state = next;
    lobby.hidden = true;
    stage.hidden = false;

    tableCodeEl.textContent = `${next.code} 📋`;
    pinBtn.textContent = next.hasLocation ? "📍 Aktiv" : "📍 Teilen";

    const isJass = next.mode === "jass";
    const isTschau = next.mode === "tschau";
    const meta = DECK_META[next.deck] ?? DECK_META.swiss36;
    if (isJass) {
      const suit = meta.suits.find((s) => s.id === next.trump);
      trumpBtn.textContent = next.trump
        ? (suit ? `Trumpf: ${suit.name}` : next.trump === "obe" ? "↑ Obenabe" : "↓ Undeufe")
        : "Trumpf wählen";
      trumpBtn.disabled = false;
      trumpBtn.hidden = false;
    } else if (isTschau && next.wishSuit) {
      const suit = meta.suits.find((s) => s.id === next.wishSuit);
      trumpBtn.textContent = `Wunsch: ${suit?.name ?? next.wishSuit}`;
      trumpBtn.disabled = true;
      trumpBtn.hidden = false;
    } else {
      trumpBtn.hidden = true;
    }

    const roundFinished = next.round > 0 && (Boolean(next.winnerId) || (next.pile.length === 0 && next.players.every((p) => p.cardCount === 0)));
    if (next.round === 0 || roundFinished) {
      overlay.hidden = false;
      const winner = next.players.find((p) => p.id === next.winnerId);
      overlayTitle.textContent = next.round === 0
        ? `Tisch ${next.code} (${next.players.length} Spieler)`
        : winner ? `Sepp! ${winner.name} gewinnt!` : `Runde ${next.round} beendet`;
      overlayPlayers.innerHTML = "";
      const list = roundFinished ? [...next.players].sort((a, b) => b.points - a.points) : next.players;
      for (const p of list) {
        const li = document.createElement("li");
        const left = document.createElement("span");
        left.textContent = p.name + (p.id === next.me?.id ? " (Du)" : "");
        const right = document.createElement("span");
        right.textContent = roundFinished
          ? (isJass ? `${p.points} P. (${p.tricks} Stiche)` : `${p.points} Siege`)
          : (p.isBot ? "Bot" : "Bereit");
        li.append(left, right);
        overlayPlayers.append(li);
      }
      quickStartBtn.hidden = next.round > 0 || (isJass && next.players.length >= 4) || (isTschau && next.players.length >= 3) || (next.mode === "free" && next.players.length >= 2);
      quickStartBtn.textContent = isJass ? "Mit Bots starten (4er-Jass)" : isTschau ? "Mit Bots starten (Tschau Sepp)" : "Mit Bot starten";
      overlayDealBtn.textContent = roundFinished ? "Neue Runde geben" : "Karten geben";
      overlayShareBtn.hidden = next.round > 0;
      overlayPinBtn.hidden = next.round > 0;
      overlayPinBtn.textContent = next.hasLocation ? "📍 Position aktiv" : "📍 Position teilen";
    } else {
      overlay.hidden = true;
    }

    tableCanvas.resize();
    tableCanvas.setState(next);
  }

  async function enterTable(code) {
    setStatus("");
    lobby.hidden = true;
    stage.hidden = false;
    enterFullscreen();
    try {
      const coords = await silentPosition();
      const res = await run({ op: "join", code, ...(coords ?? {}) });
      if (res?.table) {
        openStream(res.table.code);
        const url = new URL(location.href);
        url.searchParams.set("jass", res.table.code);
        history.replaceState(history.state, "", url);
      }
    } catch (e) {
      await exitFullscreen();
      stage.hidden = true;
      lobby.hidden = false;
      throw e;
    }
  }

  async function createTable() {
    setStatus("Erstelle Tisch…");
    // Enter fullscreen synchronously from the click gesture so requestFullscreen() is allowed.
    lobby.hidden = true;
    stage.hidden = false;
    enterFullscreen();
    try {
      const coords = await silentPosition();
      const res = await run({
        op: "create",
        deck: deckPick.value,
        mode: modePick.value,
        ...(coords ?? {}),
      });
      if (res?.table) {
        openStream(res.table.code);
        const url = new URL(location.href);
        url.searchParams.set("jass", res.table.code);
        history.replaceState(history.state, "", url);
        toast(`Tisch ${res.table.code} bereit`);
      }
    } catch (e) {
      await exitFullscreen();
      stage.hidden = true;
      lobby.hidden = false;
      setStatus(e?.message || "Tisch konnte nicht erstellt werden.");
    }
  }

  async function searchNearby() {
    setStatus("Suche Position…");
    try {
      const pos = await getPosition();
      const res = await run({ op: "nearby", lat: pos.lat, lon: pos.lon, radius });
      const list = res?.tables ?? [];
      nearbyList.innerHTML = "";
      nearbyBox.hidden = false;
      if (!list.length) {
        setStatus("Keine offenen Tische in der Nähe gefunden. Erstelle einfach einen neuen Tisch!");
        return;
      }
      setStatus(`${list.length} Tisch(e) in der Nähe gefunden.`);
      for (const item of list) {
        const li = document.createElement("li");
        const info = document.createElement("span");
        info.textContent = `${item.name} (${item.code}) · ${item.players} Spieler · ${formatDistance(item.distance)}`;
        const btn = document.createElement("button");
        btn.type = "button";
        btn.textContent = "Beitreten";
        btn.addEventListener("click", () => enterTable(item.code).catch((e) => setStatus(e?.message || String(e))));
        li.append(info, btn);
        nearbyList.append(li);
      }
    } catch (err) {
      setStatus(err?.code === 1
        ? "Standort-Freigabe abgelehnt — nutze stattdessen den 4-stelligen Tisch-Code."
        : "Standort nicht verfügbar (evtl. unsichere Verbindung/HTTP) — nutze stattdessen den 4-stelligen Tisch-Code.");
    }
  }

  async function releaseWakeLock() {
    try { await wakeLock?.release(); } catch { /* ignore */ }
    wakeLock = null;
  }

  async function requestWakeLock() {
    try {
      if ("wakeLock" in navigator) wakeLock = await navigator.wakeLock.request("screen");
    } catch { /* ignore */ }
  }

  async function enterFullscreen() {
    if (document.fullscreenElement === stage || fakeFullscreen) return;
    if (stage.requestFullscreen) {
      try {
        await stage.requestFullscreen();
      } catch {
        fakeFullscreen = true;
        stage.classList.add("-is-fullscreen");
      }
    } else {
      fakeFullscreen = true;
      stage.classList.add("-is-fullscreen");
    }
    await requestWakeLock();
    setTimeout(() => tableCanvas.resize(), 80);
  }

  async function exitFullscreen() {
    if (document.fullscreenElement === stage) await document.exitFullscreen().catch(() => {});
    fakeFullscreen = false;
    stage.classList.remove("-is-fullscreen");
    await releaseWakeLock();
    setTimeout(() => tableCanvas.resize(), 80);
  }

  async function toggleFullscreen() {
    if (document.fullscreenElement === stage || fakeFullscreen) await exitFullscreen();
    else await enterFullscreen();
  }

  document.addEventListener("fullscreenchange", () => {
    const isFs = document.fullscreenElement === stage;
    if (!isFs && !fakeFullscreen) releaseWakeLock();
    setTimeout(() => tableCanvas.resize(), 80);
  }, { signal });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && state?.code) {
      openStream(state.code);
      run({ op: "state", code: state.code }).catch(() => {});
    }
  }, { signal });

  window.addEventListener("online", () => {
    if (state?.code) {
      openStream(state.code);
      run({ op: "state", code: state.code }).catch(() => {});
    }
  }, { signal });

  signal?.addEventListener("abort", () => {
    closeStream();
    releaseWakeLock();
    tableCanvas.destroy();
  });

  createBtn.addEventListener("click", createTable);
  nearbyBtn.addEventListener("click", searchNearby);

  joinForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const code = codeInput.value.trim().toUpperCase();
    if (!code) return;
    enterTable(code).catch((err) => setStatus(err?.message || "Tisch nicht gefunden."));
  });

  const shareInvite = async () => {
    if (!state) return;
    const url = new URL(location.href);
    url.searchParams.set("jass", state.code);
    try {
      if (navigator.share) {
        await navigator.share({ title: `Jasstisch ${state.code}`, url: url.href });
      } else {
        await navigator.clipboard.writeText(url.href);
        toast(`Link kopiert (${state.code})`);
      }
    } catch {
      toast(`Code: ${state.code}`);
    }
  };

  const sharePin = async () => {
    if (!state) return;
    toast("Standort wird abgefragt…");
    try {
      const pos = await getPosition();
      await run({ op: "location", code: state.code, lat: pos.lat, lon: pos.lon });
      toast("Position geteilt — Freunde in der Nähe sehen diesen Tisch!");
    } catch (err) {
      toast(err?.code === 1 ? "Standort-Freigabe abgelehnt" : "Standort nicht verfügbar");
    }
  };

  tableCodeEl.addEventListener("click", shareInvite);
  overlayShareBtn.addEventListener("click", shareInvite);
  pinBtn.addEventListener("click", sharePin);
  overlayPinBtn.addEventListener("click", sharePin);

  quickStartBtn.addEventListener("click", () => {
    if (!state) return;
    run({ op: "quickStart", code: state.code }).catch((e) => toast(e?.message || String(e)));
  });

  overlayDealBtn.addEventListener("click", () => {
    if (!state) return;
    run({ op: "deal", code: state.code }).catch((e) => toast(e?.message || String(e)));
  });

  trumpBtn.addEventListener("click", () => {
    openSuitDialog("Trumpf wählen", (id) => {
      run({ op: "configure", code: state.code, trump: id }).catch((e) => toast(e?.message || String(e)));
    }, true);
  });

  fsBtn.addEventListener("click", () => toggleFullscreen());

  leaveBtn.addEventListener("click", async () => {
    const code = state?.code;
    closeStream();
    if (fakeFullscreen || document.fullscreenElement === stage) await toggleFullscreen();
    state = null;
    stage.hidden = true;
    lobby.hidden = false;
    const url = new URL(location.href);
    url.searchParams.delete("jass");
    history.replaceState(history.state, "", url);
    if (code) run({ op: "leave", code }).catch(() => {});
  });

  // Auto-join if opened via an invite link (?jass=CODE)
  const initialCode = box.dataset.joinCode;
  if (initialCode) {
    enterTable(initialCode).catch((e) => setStatus(e?.message || `Tisch ${initialCode} nicht gefunden.`));
  }
});
