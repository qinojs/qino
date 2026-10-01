import { api } from "@qino/pub/api.js";
import { markdown } from "@qino/m/cms.backend.ai1/pub/markdown.js";

const KEY = "ai1.chat:session"; // the session to go on with after a reload
const SHORT = 80; // characters of a folded message

// The conversation as in cms.backend.ai1.agents: the user on the right, the agent on the left, its
// tool calls and their results folded.
const h = (tag, props, ...children) => {
  const el = Object.assign(document.createElement(tag), props);
  el.append(...children.filter((child) => child != null && child !== ""));
  return el;
};
/** In its own color, the same everywhere (cms.backend's uniqueColor), to find it again at a glance. */
const colored = (value) => {
  let n = 0;
  for (let i = 0; i < value.length; i++) n = (n * 31 + value.charCodeAt(i)) >>> 0;
  return h("span", { style: `color:hsl(${n % 360} 55% 45%)` }, value);
};
const time = (unix) => {
  const iso = new Date(unix * 1000).toISOString(), el = h("u2-time", {}, iso.slice(0, 16).replace("T", " "));
  for (const [name, value] of Object.entries({ datetime: iso, type: "relative", minute: "", mode: "narrow" })) el.setAttribute(name, value);
  return el;
};
const textOf = (content) => typeof content === "string" ? content : (content ?? []).map((p) => p.text ?? `[${p.type}]`).join(" ");
/** JSON text indented, other text as it is. */
const pretty = (value) => {
  if (typeof value === "string") try { value = JSON.parse(value); } catch { return value; }
  return JSON.stringify(value, null, 2);
};
/** Small and cut, all of it when opened. */
const folded = (summary, all) => h("details", {},
  h("summary", {}, h("small", {}, summary.length > SHORT ? summary.slice(0, SHORT) + " …" : summary)),
  h("pre", { style: "white-space:pre-wrap;overflow:auto;max-height:20rem" }, h("small", {}, all)));

/** One message: an answer as markdown, what was said as text, calls and results folded. */
async function entry({ role, content, toolCalls, time: at, model, provider, tools, prefer }) {
  const text = textOf(content);
  const head = h("small", {}, at ? time(at) : "", at ? " · " : "", role,
    ...model ? [" · ", colored(model), ...provider ? [" ", h("small", {}, "@ ", colored(provider))] : []] : []);
  // what the model was given as the session started (its role with memories, its tools, prefer), or a note
  if (role === "system") return h("div", {}, head, prefer ? h("small", {}, ` prefer ${JSON.stringify(prefer)}`) : "", folded(text, text),
    tools ? folded(`${tools.length} tools: ${tools.map((t) => t.name).join(", ")}`, pretty(tools)) : "");
  if (role === "tool") return h("div", { style: "align-self:flex-start; max-width:80%" }, folded(`← ${text}`, pretty(text)));
  const div = h("div", { style: `align-self:${role === "user" ? "flex-end" : "flex-start"}; max-width:80%` }, head);
  if (text && role === "assistant") div.append(h("div", { innerHTML: await markdown(text) }));
  else if (text) div.append(h("div", { style: `white-space:pre-wrap;${role === "error" ? "color:var(--red)" : ""}` }, text));
  for (const call of toolCalls ?? []) div.append(folded(`→ ${call.name}(${JSON.stringify(call.args)})`, pretty(call.args)));
  return div;
}

cms.initNode("backend.ai1.chat", (el) => {
  const agents = api["ai1.agent"];
  const ask = el.querySelector("[data-ask]"), log = el.querySelector("[data-log]"), title = el.querySelector("[data-title]");
  const alert = async (message) => (await import("@qino/u2/js/dialog/dialog.js")).alert(message);
  let session = Number(new URL(location.href).searchParams.get("session")) || Number(sessionStorage.getItem(KEY)) || undefined;
  let last = 0, sent, showing = Promise.resolve();

  // only the messages since the last one are added, so what is opened or selected stays as it is; one
  // after the other, as it is also called while an answer is on its way
  const show = () => showing = showing.catch(() => {}).then(async () => {
    const id = session, { agent, messages } = await agents.sessions(id).get();
    if (id !== session) return;
    title.replaceChildren(colored(`#${agent}`), ` · ${id}`);
    const news = messages.filter((m) => m.id > last);
    if (!news.length) return;
    last = news.at(-1).id;
    sent?.remove(); // shown until it is kept
    log.append(...await Promise.all(news.map(entry)));
    log.scrollTop = log.scrollHeight;
  });
  const open = (id) => {
    sessionStorage.setItem(KEY, session = id);
    last = 0;
    sent = undefined;
    log.replaceChildren();
    ask.hidden = false;
    for (const button of el.querySelectorAll("[data-session]")) button.setAttribute("aria-current", String(+button.dataset.session === id));
    return show();
  };
  if (session) open(session).catch(() => { sessionStorage.removeItem(KEY); ask.hidden = true; }); // gone or not ours

  const node = api.cms.node(Number(cms.el.nid(el)));
  const start = el.querySelector("[data-start]");
  const sliders = start.querySelectorAll("input[data-prefer]"); // the options carry their agent's data-prefer too
  // The sliders show the chosen agent's choice. Untouched, the session keeps none of its own: the
  // agent's counts, also when it changes later.
  let own = false;
  const weights = () => own ? Object.fromEntries([...sliders].filter((s) => +s.value).map((s) => [s.dataset.key, +s.value])) : {};
  const agentChoice = () => {
    const prefer = JSON.parse(start.elements.agent.selectedOptions[0]?.dataset.prefer || "{}");
    for (const slider of sliders) slider.nextElementSibling.value = slider.value = prefer[slider.dataset.key] ?? 0;
    own = false;
  };

  let waiting;
  const preview = () => {
    clearTimeout(waiting);
    waiting = setTimeout(async () => {
      const { list = [] } = await node.api.post({ preview: weights(), agent: Number(start.elements.agent.value) }).catch(() => ({}));
      start.querySelector("[data-preview]").replaceChildren(...list.map((c) => Object.assign(document.createElement("li"), { textContent: `${c.model} @ ${c.provider} (${c.rank})` })));
    }, 150);
  };
  start.addEventListener("input", (e) => {
    if ("prefer" in e.target.dataset) {
      e.target.nextElementSibling.value = e.target.value;
      own = true;
    }
    preview();
  });
  start.elements.agent.addEventListener("change", agentChoice);
  agentChoice();
  preview();
  start.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const agent = Number(start.elements.agent.value);
      const id = (await agents.agents(agent).sessions.post({ prefer: weights() })).id;
      const url = new URL(location.href);
      url.searchParams.set("session", id);
      const link = h("a", { href: url.href }, `#${id}`);
      const first = h("td", {}, "–");
      link.dataset.session = id;
      first.dataset.first = "";
      const row = h("tr", {}, h("th", {}, link), h("td", {}, colored(`#${agent}`)), first);
      row.setAttribute("u2-href", "");
      el.querySelector("[data-sessions]").prepend(row);
      history.replaceState(null, "", url);
      await open(id);
    } catch (err) { await alert(err.message); }
  });

  ask.addEventListener("submit", async (e) => {
    e.preventDefault();
    const field = ask.elements.content, button = ask.querySelector("button"), content = field.value;
    field.value = "";
    button.disabled = true;
    log.append(sent = await entry({ role: "user", content }));
    log.scrollTop = log.scrollHeight;
    const poll = setInterval(() => show().catch(() => {}), 2000); // the steps of the answer, as they are kept
    const id = session;
    try {
      await agents.sessions(id).ask.post({ content });
      const first = [...el.querySelectorAll("[data-session]")].find((button) => +button.dataset.session === id)?.closest("tr").querySelector("[data-first]");
      const line = content.replace(/\s+/g, " ").trim();
      if (first?.textContent === "–") first.textContent = line.slice(0, SHORT) + (line.length > SHORT ? " …" : "");
    } catch (err) { await alert(err.message); }
    clearInterval(poll);
    button.disabled = false;
    await show();
  });
  // As other chats: Enter sends, Shift + Enter makes a new line; not while an input method composes,
  // not on a touch screen (there the button sends), not while an answer is on its way
  ask.elements.content.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || e.shiftKey || e.isComposing || matchMedia("(pointer: coarse)").matches) return;
    e.preventDefault();
    if (!ask.querySelector("button").disabled) ask.requestSubmit();
  });
});
