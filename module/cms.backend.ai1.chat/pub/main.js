import { api } from "@qino/pub/api.js";
import { markdown } from "@qino/m/cms.backend.ai1/pub/markdown.js";

const KEY = "ai1.chat:session"; // the session to go on with after a reload

cms.initNode("backend.ai1.chat", (el) => {
  const agents = api["ai1.agent"];
  const ask = el.querySelector("[data-ask]"), log = el.querySelector("[data-log]"), title = el.querySelector("[data-title]");
  const alert = async (message) => (await import("@qino/u2/js/dialog/dialog.js")).alert(message);
  let session = Number(sessionStorage.getItem(KEY)) || undefined;

  // One message: an answer as markdown, what was said, called or got as plain text.
  const entry = async ({ role, content, toolCalls, model, provider, tools }) => {
    if (role === "system") { // what the agent was given from here on, folded
      const details = document.createElement("details");
      details.append(Object.assign(document.createElement("summary"), { textContent: `system · ${tools?.length ?? 0} tools` }),
        Object.assign(document.createElement("pre"), { textContent: `${content}\n\n${(tools ?? []).map((t) => t.name).join(", ")}`, style: "white-space:pre-wrap;overflow:auto" }));
      return details;
    }
    const div = document.createElement("div"), label = document.createElement("small");
    label.textContent = model ? `${role} · ${model}${provider ? ` @ ${provider}` : ""}` : role;
    div.append(label);
    const text = typeof content === "string" ? content : (content ?? []).map((p) => p.text ?? `[${p.type}]`).join(" ");
    if (role === "assistant" && text) div.insertAdjacentHTML("beforeend", await markdown(text));
    const plain = [role === "assistant" ? "" : text, ...(toolCalls ?? []).map((c) => `→ ${c.name}(${JSON.stringify(c.args)})`)].filter(Boolean).join("\n");
    if (plain) div.append(Object.assign(document.createElement("pre"), { textContent: plain.length > 2000 ? plain.slice(0, 2000) + " …" : plain, style: "white-space:pre-wrap;overflow:auto" }));
    return div;
  };

  const show = async () => {
    const { agent, messages } = await agents.sessions(session).get();
    title.textContent = `#${agent} · ${session}`;
    log.replaceChildren(...await Promise.all(messages.map(entry)));
  };
  const open = (id) => {
    sessionStorage.setItem(KEY, session = id);
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

  // An agent's form: save it (a new one is created), and maybe start a session with it.
  el.addEventListener("submit", async (e) => {
    const form = e.target;
    if (!("agent" in form.dataset)) return;
    e.preventDefault();
    const values = { system: form.elements.system.value, tools: [...form.querySelectorAll("[name=tools]:checked")].map((box) => box.value), prefer: weights(form, "agent") };
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
    log.append(await entry({ role: "user", content }));
    try { await agents.sessions(session).ask.post({ content }); } catch (err) { await alert(err.message); }
    button.disabled = false;
    await show();
  });
  ask.elements.content.addEventListener("keydown", (e) => (e.ctrlKey || e.metaKey) && e.key === "Enter" && ask.requestSubmit());
});
