import { api } from "@qino/pub/api.js";
import { t } from "@qino/pub/t.js";
import { markdown } from "@qino/m/cms.backend.ai/pub/markdown.js";
import { onShortcut } from "@qino/m/cms.frontend.4/pub/js/shortcut.js";

// The site assistant as an item of the CMS panel's sidebar, beside "Structure" and "Settings" (mounted into
// the panel as cms.versions does). One session per user that stays (the module's `session` route); the
// page the user is on and what they click in "show" mode go to the agent as notes, read with the next
// question.

const NAME = "cms.frontend.ai.chat";
const ID = "ai-chat"; // the sidebar item
const { page, editmode } = globalThis.qino[NAME];
const NOTED = NAME + ":noted"; // per viewer: where the agent was told the user is
const DETACHED = NAME + ":detached", AT = NAME + ":at"; // per viewer: the chat in its own window, and where
const SHOWN = "Shown: ", ON = "On page "; // the notes this chat sends, shown in the log
const SHORT = 200; // characters of a shown element's text

const keep = { // storage can be missing or throw (private windows): then nothing is remembered
  get: (key) => { try { return localStorage.getItem(key); } catch { return null; } },
  set: (key, value) => { try { localStorage.setItem(key, value); } catch { /**/ } },
};
const h = (tag, props, ...children) => {
  const el = Object.assign(document.createElement(tag), props);
  el.append(...children.filter((child) => child != null && child !== ""));
  return el;
};
const short = (text, max = SHORT) =>
  (text = text.replace(/\s+/g, " ").trim()).length > max ? text.slice(0, max) + " …" : text;
const textOf = (content) =>
  typeof content === "string" ? content : (content ?? []).map((p) => p.text ?? `[${p.type}]`).join(" ");

const [
  label, sendLabel, stopLabel, showLabel, freshLabel, placeholder, changedLabel, reloadLabel, detachLabel, dockLabel,
  latestLabel,
] = await Promise.all([
  t`Assistant`, t`Send`, t`Stop`, t`Show me something`, t`New conversation`, t`Enter sends, Shift + Enter makes a new line`,
  t`The page has changed beyond what could be updated.`, t`Reload`, t`Detach`, t`Dock`, t`To the latest`,
]);

await customElements.whenDefined("qino-cms");
const host = document.querySelector("qino-cms"), root = host.shadowRoot;
host.addStyle(NAME + "/pub/chat.css");
const alert = (message) => root.alert(message); // the CMS dialogs

const pick = h("button", { type: "button", className: "-pick", ariaPressed: "false" }, showLabel);
/** A u2 icon (Material Symbols, as in the panel), the text where it doesn't load. */
const ico = (name, text) => {
  const el = h("u2-ico", {}, text);
  el.setAttribute("icon", name);
  return el;
};
const iconButton = (title, icon) => h("button", { type: "button", className: "u2-unstyle", title, ariaLabel: title }, icon);
const fresh = iconButton(freshLabel, ico("add_comment", "＋"));
const detachIco = ico("open_in_new", "⧉");
const detach = iconButton(detachLabel, detachIco);
const log = h("div", { className: "-log" });
const down = h("button", {
  type: "button", className: "-down u2-unstyle", hidden: true, title: latestLabel, ariaLabel: latestLabel,
}, ico("arrow_downward", "↓"));
const field = h("textarea", { name: "content", rows: 3, required: true, placeholder });
const button = h("button", {}, sendLabel);
const ask = h("form", { className: "-ask" }, field, button);
// one title bar, in the panel as in its own window, where it is what moves it (u2-movable)
const bar = h("div", { className: "-bar" }, h("span", {}, label), fresh, detach);
bar.setAttribute("u2-movable-handler", "");
const box = h("div", { className: "-chat" }, bar,
  h("div", { className: "-scroll" }, log, down), pick, ask); // the arrow over the log, out of its layout
const content = h("div", { className: "-content" }, box);
const item = h("div", { className: "-item" },
  content, h("div", { className: "-title" }, h("div", { className: "-text", title: label }, label)));
item.setAttribute("itemid", ID);
root.getElementById("panel").querySelector(":scope > .-sidebar > .-sensor").before(item);
// detached, the chat is a window of its own in the CMS root, moved by its title bar; a popover, so it is
// above the panel, as it glides out of it and back
import("@qino/u2/attr/movable/movable.js");
const float = h("div", { className: "-ai-chat-float", popover: "manual" });
float.setAttribute("u2-movable", "");
root.append(float);
// "show" hides the panel, so the mark and the cursor are the page's
const mark = h("div", {
  style: "position:fixed; z-index:2147483647; pointer-events:none; outline:2px solid Highlight; display:none",
});
const crosshair = h("style", {}, "* { cursor: crosshair !important }");
document.body.append(mark);

const chat = api[NAME], sessions = api["ai.agent"].sessions;
let session, last = 0, sent, busy = false, poll, showing = Promise.resolve(), changes;

/** One message: an answer as markdown, what was said as text, this chat's notes small; nothing else. */
async function entry({ role, content }) {
  const text = textOf(content);
  if (!text || role === "tool") return "";
  if (role === "system") { // this chat's notes, by their first line
    return text.startsWith(SHOWN) || text.startsWith(ON) ? h("div", { className: "-note", title: text }, text.split("\n")[0]) : "";
  }
  if (role === "assistant") return h("div", { className: "-assistant", innerHTML: await markdown(text) });
  return h("div", { className: role === "error" ? "-error" : "-user" }, text);
}

// at the end, the log stays there while it or what is in it grows or shrinks (new messages, markdown,
// detaching, resizing); scrolled up, it stays where it is, with an arrow back down
let pinned = true;
const atEnd = () => log.scrollHeight - log.scrollTop - log.clientHeight < 10;
const sync = () => {
  if (pinned) log.scrollTop = log.scrollHeight;
  down.hidden = pinned ||= atEnd();
};
// only scrolling up lets go: the event comes a frame late, when a log that shrinks (gliding, resizing)
// is no longer at its end although nobody scrolled
let top = 0;
log.addEventListener("scroll", () => {
  if (atEnd()) pinned = true;
  else if (log.scrollTop < top) pinned = false;
  top = log.scrollTop;
  down.hidden = pinned;
});
down.addEventListener("click", () => log.scrollTo({ top: log.scrollHeight, behavior: "smooth" }));
const sizes = new ResizeObserver(sync);
sizes.observe(log);
const append = (els) => {
  log.append(...els);
  for (const el of els) if (el instanceof Element) sizes.observe(el);
  sync();
};
// while an answer is on its way, the send button stops it, and its steps show as they are kept
const working = (on) => {
  busy = on;
  button.textContent = on ? stopLabel : sendLabel;
  clearInterval(poll);
  if (on) poll = setInterval(() => show().catch(() => {}), 2000);
};
/** What changed on this page since last asked (cms's node_changed) is rendered anew: the outermost
 *  changed block, the parent of a new or deleted one. What has no block here (the page's own title,
 *  url, settings) gets a hint to reload. The first call only marks where to go on from. */
async function refresh() {
  const { last: now, nodes } = await chat.changed.get({ page, after: changes });
  const first = changes == null;
  changes = now;
  if (first || !nodes.length) return;
  const blocks = new Set(), find = (id) => id != null && document.querySelector(`[qcms-id="${id}"]`);
  let missed = false;
  for (const { id, basis } of nodes) {
    const el = find(id), block = el ? (basis == null ? el.parentElement?.closest("[qcms-id]") : el) : find(basis);
    if (block && block.getAttribute("qcms-id") !== String(page)) blocks.add(block);
    else missed = true;
  }
  for (const el of blocks) {
    if (![...blocks].some((other) => other !== el && other.contains(el))) await cms.reloadNode(el.getAttribute("qcms-id"));
  }
  if (!missed) return;
  const reload = h("button", { type: "button", onclick: () => location.reload() }, reloadLabel);
  append([h("div", { className: "-note" }, changedLabel, " ", reload)]);
}
// only what came since the last message, one call after the other; what the agent changed shows at once
const show = () => showing = showing.catch(() => {}).then(async () => {
  const id = session, was = busy, { messages, running } = await sessions(id).get({ after: last });
  if (id !== session) return;
  if (running !== busy) working(running);
  if (messages.some((m) => m.role === "tool") || was && !running) await refresh().catch(() => {});
  if (!messages.length) return;
  last = messages.at(-1).id;
  sent?.remove(); // shown until it is kept
  sent = undefined;
  append(await Promise.all(messages.map(entry)));
});
const open = async (id) => {
  session = id, last = 0, sent = undefined, pinned = true, top = 0, down.hidden = true;
  log.replaceChildren();
  await show();
};

/** Where the user is, as a note, once per page and session. */
async function where() {
  const here = `${ON}${page} "${location.pathname}", editmode ${editmode ? "on" : "off"}`;
  if (keep.get(NOTED) === `${session} ${here}`) return;
  await sessions(session).note.post({ content: here });
  keep.set(NOTED, `${session} ${here}`);
}
const note = (content) => where().then(() => sessions(session).note.post({ content })).then(show);

// the panel opens and closes its sidebar items: the first time it opens this one, the session is loaded
let started; // the session, loaded once: opening, docking and the key may ask for it at once
const start = async () => {
  await (started ??= Promise.all([refresh(), chat.session.get().then(({ id }) => open(id))])
    .catch((err) => { started = undefined; throw err; }));
  field.focus();
};
const detached = () => float.matches(":popover-open");
const opened = async () => {
  if (!item.classList.contains("-open")) return picking(false);
  if (detached()) await glideIn(); // opened in the panel: it comes back
  await start();
};
/** In the panel, or in its own window where it was left; detaching closes the panel. */
function docked(on) {
  keep.set(DETACHED, on ? "" : "1");
  detach.title = detach.ariaLabel = on ? detachLabel : dockLabel;
  detachIco.setAttribute("icon", on ? "open_in_new" : "keyboard_tab");
  (on ? content : float).append(box);
  pinned = true, top = 0; // moving it lost the scroll position: at the end again, here and while it glides
  if (on) return float.hidePopover(), sync();
  float.style.transform = keep.get(AT) ?? "";
  if (!detached()) float.showPopover();
  sync();
  globalThis.cms?.panel?.sidebar.set("");
  start().catch((err) => alert(err.message));
}

// Gliding: the window starts over the panel's content and goes to its place, or the other way; its box
// moves and resizes (no scale, which would stretch the text too)
const GLIDE = { duration: 250, easing: "ease-in-out" };
const frame = ({ top, left, width, height }) => ({
  top: top + "px", left: left + "px", width: width + "px", height: height + "px",
  right: "auto", bottom: "auto", transform: "none",
});
function glideOut() {
  const from = content.getBoundingClientRect();
  docked(false);
  float.animate([frame(from), frame(float.getBoundingClientRect())], GLIDE);
}
/** The panel's content slides in first, then the window glides into it. */
async function glideIn() {
  getComputedStyle(content).transform; // its slide has started
  await Promise.all(content.getAnimations().map((a) => a.finished)).catch(() => {});
  const to = content.getBoundingClientRect();
  const glide = float.animate([frame(float.getBoundingClientRect()), frame(to)], { ...GLIDE, fill: "forwards" });
  await glide.finished.catch(() => {});
  docked(true);
  glide.cancel();
}
// docking shows the panel (as its edge does on hover) and opens the item, which brings it in (opened);
// without the panel, at once
const toPanel = () => {
  root.getElementById("panel").classList.add("-sidebar-open");
  cms.panel.sidebar.set(ID);
};
detach.addEventListener("click", () => {
  if (!detached()) return glideOut();
  if (!globalThis.cms?.panel) return docked(true);
  toPanel();
});
globalThis.addEventListener("pointerup", () => detached() && keep.set(AT, float.style.transform)); // where it was moved to
new MutationObserver(() => opened().catch((err) => alert(err.message))).observe(item, { attributeFilter: ["class"] });
if (keep.get(DETACHED)) docked(false);
else if (globalThis.qino.cms?.ui?.sidebar === ID) item.classList.add("-open"); // open when the page was left
fresh.addEventListener("click", async () => {
  try { await open((await chat.session.post()).id); } catch (err) { await alert(err.message); }
});

button.addEventListener("click", (e) => {
  if (!busy) return;
  e.preventDefault(); // no submit, also not blocked by the empty field
  sessions(session).cancel.post().catch((err) => alert(err.message));
});
ask.addEventListener("submit", async (e) => {
  e.preventDefault();
  const content = field.value;
  field.value = "";
  sent = h("div", { className: "-user" }, content);
  append([sent]);
  try {
    await where();
    await sessions(session).ask.post({ content }); // at once: the answer comes with show()
  } catch (err) { await alert(err.message); }
  await show();
});
// as other chats: Enter sends, Shift + Enter makes a new line; not while an input method composes,
// not on a touch screen (there the button sends), not while an answer is on its way
field.addEventListener("keydown", (e) => {
  if (e.key !== "Enter" || e.shiftKey || e.isComposing || matchMedia("(pointer: coarse)").matches) return;
  e.preventDefault();
  if (!busy) ask.requestSubmit();
});

// "show": the panel steps aside and the cursor becomes a crosshair; the element under the pointer is
// marked, a click gives it to the agent, with the content block it is in, and brings the panel back.
// Captured on window, before the page, the editor and the panel get it. Esc ends it too.
const ATTRS = ["id", "class", "alt", "title", "name", "type", "placeholder", "aria-label", "role"];
const target = (e) =>
  e.composedPath().includes(host) || e.target === document.documentElement || e.target === document.body ? undefined : e.target;
/** Where it is in its block, as a css selector: tag names, numbered among their kind. */
const path = (el, block) => {
  const steps = [];
  for (; el && el !== block && el !== document.body; el = el.parentElement) {
    const same = [...el.parentElement?.children ?? []].filter((c) => c.localName === el.localName);
    steps.unshift(el.localName + (same.length > 1 ? `:nth-of-type(${same.indexOf(el) + 1})` : ""));
  }
  return steps.join(" > ");
};
const nodeOf = (block) => {
  const mod = block.getAttribute("qcms-mod"), name = block.getAttribute("qcms-name");
  return `node ${block.getAttribute("qcms-id")}${mod ? ` (${mod})` : ""}${name ? ` named "${name}"` : ""}`;
};
/** What a click showed, one fact a line: the element, its content node and the ones around it, the
 *  text field, link, image or form field it belongs to, where it is; never a password. */
function describe(el) {
  const attrs = ATTRS.filter((a) => el.hasAttribute(a)).map((a) => ` ${a}="${short(el.getAttribute(a), 120)}"`).join("");
  const lines = [`${SHOWN}<${el.localName}${attrs}>`];
  const blocks = [];
  for (let block = el.closest("[qcms-id]"); block && blocks.length < 4; block = block.parentElement?.closest("[qcms-id]")) {
    blocks.push(block);
  }
  if (blocks.length) lines.push(`- in ${blocks.map(nodeOf).join(", in ")}; the page is node ${page}`);
  const field = el.closest("[cmstxt]");
  const fieldName = field?.getAttribute("cmstxt-placeholder");
  if (field) lines.push(`- text: id ${field.getAttribute("cmstxt")}${fieldName ? `, name "${fieldName}"` : ""}`);
  const link = el.closest("a[href]");
  if (link) lines.push(`- link: ${link.href}${link.target ? ` (target ${link.target})` : ""}`);
  const img = el.closest("img") ?? (el.querySelectorAll("img").length === 1 ? el.querySelector("img") : null);
  if (img) {
    lines.push(`- image: ${img.currentSrc || img.src}${img.alt ? `, alt "${short(img.alt, 120)}"` : ""}, ` +
      `${img.width}×${img.height} shown, ${img.naturalWidth}×${img.naturalHeight} natural`);
  }
  const input = el.closest("input, select, textarea, button");
  if (input) {
    const label = [...input.labels ?? []].map((l) => l.innerText).join(" ").trim();
    const value = input.type === "password" || input.localName === "button" ? "" : String(input.value ?? "");
    lines.push(`- form field: <${input.localName}>` + [
      input.name && ` name "${input.name}"`, input.type && `, type ${input.type}`, label && `, label "${short(label, 120)}"`,
      value && `, value "${short(value, 120)}"`, input.form?.action && `, form action ${input.form.action}`,
    ].filter(Boolean).join(""));
  }
  const text = short(el.innerText ?? "");
  if (text) lines.push(`- text content: "${text}"`);
  const selected = getSelection()?.toString() ?? "";
  if (selected.trim() && el.contains(getSelection().anchorNode)) lines.push(`- selected: "${short(selected)}"`);
  const at = path(el, blocks[0]);
  if (at) lines.push(`- path${blocks.length ? ` in node ${blocks[0].getAttribute("qcms-id")}` : ""}: ${at}`);
  return lines.join("\n");
}
const hover = (e) => {
  const el = target(e);
  mark.style.display = el ? "" : "none";
  if (!el) return;
  const { top, left, width, height } = el.getBoundingClientRect();
  Object.assign(mark.style, { top: top + "px", left: left + "px", width: width + "px", height: height + "px" });
};
const swallow = (e) => target(e) && (e.preventDefault(), e.stopImmediatePropagation());
const take = (e) => {
  const el = target(e);
  if (!el) return;
  swallow(e);
  picking(false);
  note(describe(el)).catch((err) => alert(err.message));
};
const esc = (e) => e.key === "Escape" && (e.stopImmediatePropagation(), picking(false)); // not the panel's Esc
function picking(on) {
  if (on === (pick.ariaPressed === "true")) return;
  pick.ariaPressed = String(on);
  host.style.visibility = on ? "hidden" : "";
  mark.style.display = "none";
  if (on) document.head.append(crosshair);
  else crosshair.remove();
  const method = on ? "addEventListener" : "removeEventListener";
  globalThis[method]("pointermove", hover, true);
  for (const type of ["pointerdown", "mousedown", "mouseup", "touchstart"]) globalThis[method](type, swallow, true);
  globalThis[method]("click", take, true);
  globalThis[method]("keydown", esc, true);
}
pick.addEventListener("click", () => picking(pick.ariaPressed !== "true"));

// "a", like the panel's keys (t, v, space): the chat opens, with what is under the pointer shown to it
let pointed;
document.addEventListener("pointermove", (e) => pointed = target(e), { passive: true });
onShortcut((key, e) => {
  if (key !== "a") return;
  e.preventDefault();
  const el = pointed?.isConnected ? pointed : undefined;
  if (!detached() && globalThis.cms?.panel) toPanel();
  start().then(() => el && note(describe(el))).catch((err) => alert(err.message));
});
