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
  let session = Number(sessionStorage.getItem(KEY)) || undefined, last = 0, sent, showing = Promise.resolve();

  // only the messages since the last one are added, so what is opened or selected stays as it is; one
  // after the other, as it is also called while an answer is on its way
  const show = () => showing = showing.catch(() => {}).then(async () => {
    const { agent, messages } = await agents.sessions(session).get();
    title.replaceChildren(colored(`#${agent}`), ` · ${session}`);
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
    log.replaceChildren();
    ask.hidden = false;
    return show();
  };
  if (session) open(session).catch(() => { sessionStorage.removeItem(KEY); ask.hidden = true; }); // gone or not ours

  const node = api.cms.node(Number(cms.el.nid(el)));
  const weights = (form, scope) => Object.fromEntries([...form.querySelectorAll(`[data-prefer=${scope}]`)].filter((s) => +s.value).map((s) => [s.dataset.key, +s.value]));

  // Who would answer: by the session's weights, else the agent's, as the turn chooses.
  let waiting;
  const preview = (form) => {
    clearTimeout(waiting);
    waiting = setTimeout(async () => {
      const session = weights(form, "session"), { list = [] } = await node.api.post({ preview: Object.keys(session).length ? session : weights(form, "agent") }).catch(() => ({}));
      form.querySelector("[data-preview]").replaceChildren(...list.map((c) => Object.assign(document.createElement("li"), { textContent: `${c.model} @ ${c.provider} (${c.rank})` })));
    }, 150);
  };
  el.addEventListener("input", (e) => {
    if (!e.target.dataset.prefer) return;
    e.target.nextElementSibling.value = e.target.value;
    preview(e.target.form);
  });
  el.addEventListener("toggle", (e) => e.target.open && e.target.querySelector("[data-agent]") && preview(e.target.querySelector("[data-agent]")), true);

  // A whole branch checked is its path alone: what is added below it later comes with it.
  const chosen = (form) => [...form.querySelectorAll("[name=tools]:checked")].map((box) => box.closest("u2-tree"))
    .filter((item) => !item.parentElement.closest("u2-tree")?.querySelector(":scope > [name=tools]").checked)
    .map((item) => item.querySelector(":scope > [name=tools]").value);

  // An agent's form: save it (a new one is created), and maybe start a session with it.
  el.addEventListener("submit", async (e) => {
    const form = e.target;
    if (!("agent" in form.dataset)) return;
    e.preventDefault();
    const values = { system: form.elements.system.value, tools: chosen(form), prefer: weights(form, "agent") };
    try {
      let agent = Number(form.dataset.agent);
      if (agent) await agents.agents(agent).patch(values);
      else agent = (await agents.agents.post(values)).id;
      if (e.submitter?.name === "start") await open((await agents.agents(agent).sessions.post({ prefer: weights(form, "session") })).id);
      if (!Number(form.dataset.agent)) location.reload(); // the new agent into the list
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
    try { await agents.sessions(session).ask.post({ content }); } catch (err) { await alert(err.message); }
    clearInterval(poll);
    button.disabled = false;
    await show();
  });
  ask.elements.content.addEventListener("keydown", (e) => (e.ctrlKey || e.metaKey) && e.key === "Enter" && ask.requestSubmit());
});
