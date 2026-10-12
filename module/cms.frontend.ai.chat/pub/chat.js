import { api } from "@qino/pub/api.js";
import { t } from "@qino/pub/t.js";
import { markdown } from "@qino/m/cms.backend.ai/pub/markdown.js";

// The site assistant as an item of the CMS panel's sidebar, beside "Structure" and "Settings" (mounted into
// the panel as cms.versions does). One session per user that stays (the module's `session` route); the
// page the user is on and what they click in "show" mode go to the agent as notes, read with the next
// question.

const NAME = "cms.frontend.ai.chat";
const ID = "ai-chat"; // the sidebar item
const { page, editmode } = globalThis.qino[NAME];
const NOTED = NAME + ":noted"; // per viewer: where the agent was told the user is
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
const short = (text, max = SHORT) => (text = text.replace(/\s+/g, " ").trim()).length > max ? text.slice(0, max) + " …" : text;
const textOf = (content) => typeof content === "string" ? content : (content ?? []).map((p) => p.text ?? `[${p.type}]`).join(" ");

const [label, sendLabel, stopLabel, showLabel, freshLabel, placeholder] = await Promise.all([
  t`Assistant`, t`Send`, t`Stop`, t`Show`, t`New conversation`, t`Enter sends, Shift + Enter makes a new line`,
]);

await customElements.whenDefined("qino-cms");
const host = document.querySelector("qino-cms"), root = host.shadowRoot;
host.addStyle(NAME + "/pub/chat.css");
const alert = (message) => root.alert(message); // the CMS dialogs

const pick = h("button", { type: "button", ariaPressed: "false" }, showLabel);
const fresh = h("button", { type: "button" }, freshLabel);
const log = h("div", { className: "-log" });
const field = h("textarea", { name: "content", rows: 3, required: true, placeholder });
const button = h("button", {}, sendLabel);
const ask = h("form", { className: "-ask" }, field, button);
const item = h("div", { className: "-item" },
  h("div", { className: "-content" }, h("div", { className: "-chat" }, h("div", { className: "-head" }, pick, fresh), log, ask)),
  h("div", { className: "-title" }, h("div", { className: "-text", title: label }, label)));
item.setAttribute("itemid", ID);
root.getElementById("panel").querySelector(":scope > .-sidebar > .-sensor").before(item);
const mark = h("div", { className: "-ai-chat-mark", hidden: true });
root.append(mark);

const chat = api[NAME], sessions = api["ai.agent"].sessions;
let session, last = 0, sent, busy = false, poll, showing = Promise.resolve();

/** One message: an answer as markdown, what was said as text, this chat's notes small; nothing else. */
async function entry({ role, content }) {
  const text = textOf(content);
  if (!text || role === "tool") return "";
  if (role === "system") return text.startsWith(SHOWN) || text.startsWith(ON) ? h("div", { className: "-note", title: text }, text.split("\n")[0]) : "";
  if (role === "assistant") return h("div", { innerHTML: await markdown(text) });
  return h("div", { className: role === "error" ? "-error" : "-user" }, text);
}

const append = (els) => {
  const end = log.scrollHeight - log.scrollTop - log.clientHeight < 10; // scrolled up, it stays there
  log.append(...els);
  if (end) log.scrollTop = log.scrollHeight;
};
// while an answer is on its way, the send button stops it, and its steps show as they are kept
const working = (on) => {
  busy = on;
  button.textContent = on ? stopLabel : sendLabel;
  clearInterval(poll);
  if (on) poll = setInterval(() => show().catch(() => {}), 2000);
};
// only what came since the last message, one call after the other
const show = () => showing = showing.catch(() => {}).then(async () => {
  const id = session, { messages, running } = await sessions(id).get({ after: last });
  if (id !== session) return;
  if (running !== busy) working(running);
  if (!messages.length) return;
  last = messages.at(-1).id;
  sent?.remove(); // shown until it is kept
  sent = undefined;
  append(await Promise.all(messages.map(entry)));
});
const open = async (id) => {
  session = id, last = 0, sent = undefined;
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
const opened = async () => {
  if (!item.classList.contains("-open")) return picking(false);
  if (!session) await open((await chat.session.get()).id);
  field.focus();
};
new MutationObserver(() => opened().catch((err) => alert(err.message))).observe(item, { attributeFilter: ["class"] });
if (globalThis.qino.cms?.ui?.sidebar === ID) item.classList.add("-open"); // open when the page was left
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

// "show": the element under the pointer is marked, a click gives it to the agent, with the content block
// it is in; captured on window, before the page, the editor and the panel get it. Esc or the button again
// ends it.
const ATTRS = ["id", "class", "alt", "title", "name", "type", "placeholder", "aria-label", "role"];
const target = (e) => e.composedPath().includes(host) || e.target === document.documentElement || e.target === document.body ? undefined : e.target;
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
  for (let block = el.closest("[qcms-id]"); block && blocks.length < 4; block = block.parentElement?.closest("[qcms-id]")) blocks.push(block);
  if (blocks.length) lines.push(`- in ${blocks.map(nodeOf).join(", in ")}; the page is node ${page}`);
  const field = el.closest("[cmstxt]");
  if (field) lines.push(`- text: id ${field.getAttribute("cmstxt")}${field.hasAttribute("cmstxt-placeholder") ? `, name "${field.getAttribute("cmstxt-placeholder")}"` : ""}`);
  const link = el.closest("a[href]");
  if (link) lines.push(`- link: ${link.href}${link.target ? ` (target ${link.target})` : ""}`);
  const img = el.closest("img") ?? (el.querySelectorAll("img").length === 1 ? el.querySelector("img") : null);
  if (img) lines.push(`- image: ${img.currentSrc || img.src}${img.alt ? `, alt "${short(img.alt, 120)}"` : ""}, ${img.width}×${img.height} shown, ${img.naturalWidth}×${img.naturalHeight} natural`);
  const input = el.closest("input, select, textarea, button");
  if (input) {
    const label = [...input.labels ?? []].map((l) => l.innerText).join(" ").trim();
    const value = input.type === "password" || input.localName === "button" ? "" : String(input.value ?? "");
    lines.push(`- form field: <${input.localName}>${input.name ? ` name "${input.name}"` : ""}${input.type ? `, type ${input.type}` : ""}` +
      `${label ? `, label "${short(label, 120)}"` : ""}${value ? `, value "${short(value, 120)}"` : ""}${input.form?.action ? `, form action ${input.form.action}` : ""}`);
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
  mark.hidden = !el;
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
  pick.ariaPressed = String(on);
  mark.hidden = true;
  const method = on ? "addEventListener" : "removeEventListener";
  globalThis[method]("pointermove", hover, true);
  for (const type of ["pointerdown", "mousedown", "mouseup", "touchstart"]) globalThis[method](type, swallow, true);
  globalThis[method]("click", take, true);
  globalThis[method]("keydown", esc, true);
}
pick.addEventListener("click", () => picking(pick.ariaPressed !== "true"));

