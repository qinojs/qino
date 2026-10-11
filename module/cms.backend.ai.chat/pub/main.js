import { api } from "@qino/pub/api.js";
import { markdown } from "@qino/m/cms.backend.ai/pub/markdown.js";

const KEY = "ai.chat:session"; // the session to go on with after a reload
const SHORT = 80; // characters of a first message in the list of sessions

// The conversation: the user on the right, the agent on the left; what goes on behind (its role, tool
// calls and their results) is for cms.backend.ai.agents.
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

/** One message: an answer as markdown, what was said as text; nothing for what the user does not see. */
async function entry({ role, content, time: at }) {
  const text = textOf(content);
  if (!text || role === "system" || role === "tool") return "";
  const div = h("div", { style: `align-self:${role === "user" ? "flex-end" : "flex-start"}; max-width:80%` }, h("small", {}, at ? time(at) : ""));
  if (role === "assistant") div.append(h("div", { innerHTML: await markdown(text) }));
  else div.append(h("div", { style: `white-space:pre-wrap;${role === "error" ? "color:var(--red)" : ""}` }, text));
  return div;
}

cms.initNode("backend.ai.chat", (el) => {
  const agents = api["ai.agent"];
  const ask = el.querySelector("[data-ask]"), log = el.querySelector("[data-log]"), title = el.querySelector("[data-title]");
  const alert = async (message) => (await import("@qino/u2/js/dialog/dialog.js")).alert(message);
  let session = Number(new URL(location.href).searchParams.get("session")) || Number(sessionStorage.getItem(KEY)) || undefined;
  let last = 0, sent, showing = Promise.resolve();
  // while an answer is on its way, the send button stops it, and its steps show as they are kept; what
  // was said and done so far stays
  const button = ask.querySelector("button"), label = button.textContent;
  let busy = false, poll;
  const working = (on) => {
    busy = on;
    button.textContent = on ? button.dataset.stop : label;
    clearInterval(poll);
    if (on) poll = setInterval(() => show().catch(() => {}), 2000);
  };
  // talking live: the agent's voice, straight between browser and provider; what is said shows as it is kept
  const talk = ask.querySelector("[data-talk]"), talkLabel = talk?.textContent; // none without a live model
  let call, listening;
  const hangUp = () => {
    call?.close();
    call = undefined;
    clearInterval(listening);
    if (talk) talk.textContent = talkLabel;
  };

  // at the end it stays there while what is shown still grows (markdown, late layout); scrolled up, it
  // stays where it is
  let pinned = true, top = 0;
  log.addEventListener("scroll", () => {
    pinned = log.scrollTop < top ? false : pinned || log.scrollHeight - log.scrollTop - log.clientHeight < 10;
    top = log.scrollTop;
  });
  const growing = new ResizeObserver(() => pinned && (log.scrollTop = log.scrollHeight));
  const append = (...els) => {
    log.append(...els);
    for (const el of els) if (el instanceof Element) growing.observe(el);
    log.scrollTop = log.scrollHeight;
  };

  // only the messages since the last one are added, so what is opened or selected stays as it is; one
  // after the other, as it is also called while an answer is on its way
  const show = () => showing = showing.catch(() => {}).then(async () => {
    const id = session, { agent, messages: news, running } = await agents.sessions(id).get({ after: last });
    if (id !== session) return;
    if (running !== busy) working(running); // an answer on its way, also after a reload
    title.replaceChildren(colored(`#${agent}`), ` · ${id}`);
    if (!news.length) return;
    last = news.at(-1).id;
    sent?.remove(); // shown until it is kept
    append(...await Promise.all(news.map(entry)));
  });
  const open = (id) => {
    sessionStorage.setItem(KEY, session = id);
    last = 0;
    sent = undefined;
    log.replaceChildren();
    pinned = true, top = 0;
    ask.hidden = false;
    hangUp(); // the talk was with the session before
    for (const button of el.querySelectorAll("[data-session]")) button.setAttribute("aria-current", String(+button.dataset.session === id));
    return show();
  };
  if (session) open(session).catch(() => { sessionStorage.removeItem(KEY); ask.hidden = true; }); // gone or not ours

  const start = el.querySelector("[data-start]");
  start.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const agent = Number(start.elements.agent.value);
      const id = (await agents.agent(agent).sessions.post({})).id;
      const url = new URL(location.href);
      url.searchParams.set("session", id);
      const link = h("a", { href: url.href }, `#${id}`);
      const first = h("td", {}, "–");
      link.dataset.session = id;
      first.dataset.first = "";
      const row = h("tr", {}, h("th", {}, link, h("br"), h("small", {}, time(Date.now() / 1000))), h("td", {}, colored(`#${agent}`)), first);
      row.setAttribute("u2-href", "");
      el.querySelector("[data-sessions]").prepend(row);
      history.replaceState(null, "", url);
      await open(id);
      ask.elements.content.focus();
    } catch (err) { await alert(err.message); }
  });

  talk?.addEventListener("click", async () => {
    if (call) return hangUp();
    const id = session;
    try {
      const { live } = await import("@qino/m/ai/pub/live.js");
      call = await live(async (sdp) => (await agents.sessions(id).live.post({ sdp })).sdp);
      talk.textContent = talk.dataset.end;
      listening = setInterval(() => show().catch(() => {}), 2000);
    } catch (err) { await alert(err.message); }
  });
  button.addEventListener("click", (e) => {
    if (!busy) return;
    e.preventDefault(); // no submit, also not blocked by the empty field
    agents.sessions(session).cancel.post().catch((err) => alert(err.message));
  });
  ask.addEventListener("submit", async (e) => {
    e.preventDefault();
    const field = ask.elements.content, content = field.value, id = session;
    field.value = "";
    append(sent = await entry({ role: "user", content }));
    try {
      await agents.sessions(id).ask.post({ content }); // at once: the answer comes with show()
      const first = [...el.querySelectorAll("[data-session]")].find((button) => +button.dataset.session === id)?.closest("tr").querySelector("[data-first]");
      const line = content.replace(/\s+/g, " ").trim();
      if (first?.textContent === "–") first.textContent = line.slice(0, SHORT) + (line.length > SHORT ? " …" : "");
    } catch (err) { await alert(err.message); }
    await show();
  });
  // As other chats: Enter sends, Shift + Enter makes a new line; not while an input method composes,
  // not on a touch screen (there the button sends), not while an answer is on its way
  ask.elements.content.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || e.shiftKey || e.isComposing || matchMedia("(pointer: coarse)").matches) return;
    e.preventDefault();
    if (!busy) ask.requestSubmit();
  });
});
