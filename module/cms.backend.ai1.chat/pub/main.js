import { api } from "@qino/pub/api.js";

// Markdown + sanitizer (~90 KB), loaded when the first answer renders.
let markdown;
const loadMarkdown = () => markdown ??= Promise.all([
  import("https://cdn.jsdelivr.net/npm/marked@18/+esm"),
  import("https://cdn.jsdelivr.net/npm/dompurify@3/+esm"),
]).then(([{ marked }, { default: DOMPurify }]) => (md) => DOMPurify.sanitize(marked.parse(md)));

const KEY = "ai1.chat:session"; // the session to go on with after a reload

cms.initNode("backend.ai1.chat", (el) => {
  const agents = api["ai1.agent"];
  const start = el.querySelector("[data-start]"), ask = el.querySelector("[data-ask]"), log = el.querySelector("[data-log]");
  const alert = async (message) => (await import("@qino/u2/js/dialog/dialog.js")).alert(message);
  let session = Number(sessionStorage.getItem(KEY)) || undefined;

  // One message: an answer as markdown, what was said, called or got as plain text.
  const entry = async ({ role, content, toolCalls, model }) => {
    const div = document.createElement("div"), label = document.createElement("small");
    label.textContent = model ? `${role} · ${model}` : role;
    div.append(label);
    const text = typeof content === "string" ? content : (content ?? []).map((p) => p.text ?? `[${p.type}]`).join(" ");
    if (role === "assistant" && text) div.insertAdjacentHTML("beforeend", (await loadMarkdown())(text));
    const plain = [role === "assistant" ? "" : text, ...(toolCalls ?? []).map((c) => `→ ${c.name}(${JSON.stringify(c.args)})`)].filter(Boolean).join("\n");
    if (plain) div.append(Object.assign(document.createElement("pre"), { textContent: plain.length > 2000 ? plain.slice(0, 2000) + " …" : plain, style: "white-space:pre-wrap;overflow:auto" }));
    return div;
  };

  const show = async () => log.replaceChildren(...await Promise.all((await agents.sessions(session).get()).messages.map(entry)));
  const open = (id) => {
    session = id;
    sessionStorage.setItem(KEY, id);
    ask.hidden = false;
  };

  if (session) show().then(() => ask.hidden = false, () => sessionStorage.removeItem(KEY)); // gone or not ours: start anew

  // Role and tools show the chosen agent's; what is changed there, starting a session saves.
  const f = start.elements, boxes = () => [...start.querySelectorAll("[name=tools]")];
  f.agent.addEventListener("change", async () => {
    const agent = Number(f.agent.value) ? await agents.agents(Number(f.agent.value)).get() : { system: "", tools: [] };
    f.system.value = agent.system ?? "";
    for (const box of boxes()) box.checked = agent.tools.includes(box.value);
  });

  start.addEventListener("submit", async (e) => {
    e.preventDefault();
    const system = f.system.value, tools = boxes().filter((box) => box.checked).map((box) => box.value);
    const label = (id) => `#${id} ${system.split("\n")[0].slice(0, 60)}`;
    try {
      let agent = Number(f.agent.value);
      if (agent) {
        await agents.agents(agent).patch({ system, tools });
        f.agent.selectedOptions[0].text = label(agent);
      } else {
        agent = (await agents.agents.post({ system, tools })).id;
        f.agent.add(new Option(label(agent), agent), 1);
        f.agent.value = agent;
      }
      open((await agents.agents(agent).sessions.post()).id);
      log.replaceChildren();
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
