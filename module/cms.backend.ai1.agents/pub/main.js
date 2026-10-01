import { api } from "@qino/pub/api.js";
import { markdown } from "@qino/m/cms.backend.ai1/pub/markdown.js";

/** The answers in `box` as markdown. */
const render = async (box) => {
  for (const div of box.querySelectorAll("[data-md]")) div.innerHTML = await markdown(div.textContent);
};

// The tables follow what is going on, every few seconds while the page is open: the list of agents and
// all sessions, or an agent's page (`?agent=`). On a session's page (`?session=`) only its conversation
// follows along.
cms.initNode("backend.ai1.agents", (el) => {
  const nid = Number(cms.el.nid(el));
  const agents = api["ai1.agent"], node = api.cms.node(nid);
  const alert = async (message) => (await import("@qino/u2/js/dialog/dialog.js")).alert(message);
  let waiting;
  const weights = (form) => Object.fromEntries([...form.querySelectorAll("[data-prefer]")].filter((s) => +s.value).map((s) => [s.dataset.key, +s.value]));
  const preview = (form) => {
    clearTimeout(waiting);
    waiting = setTimeout(async () => {
      const { list = [] } = await node.api.post({ preview: weights(form) }).catch(() => ({}));
      form.querySelector("[data-preview]").replaceChildren(...list.map((c) => Object.assign(document.createElement("li"), { textContent: `${c.model} @ ${c.provider} (${c.rank})` })));
    }, 150);
  };
  el.addEventListener("input", (e) => {
    if (!("prefer" in e.target.dataset)) return;
    e.target.nextElementSibling.value = e.target.value;
    preview(e.target.form);
  });
  for (const form of el.querySelectorAll("[data-agent]")) preview(form);
  const chosen = (form) => [...form.querySelectorAll("[name=tools]:checked")].map((box) => box.closest("u2-tree"))
    .filter((item) => !item.parentElement.closest("u2-tree")?.querySelector(":scope > [name=tools]").checked)
    .map((item) => item.querySelector(":scope > [name=tools]").value);
  el.addEventListener("submit", async (e) => {
    const form = e.target;
    if (!("agent" in form.dataset)) return;
    e.preventDefault();
    const values = { system: form.elements.system.value, tools: chosen(form), prefer: weights(form) };
    try {
      const id = Number(form.dataset.agent);
      if (id) await agents.agent(id).patch(values);
      else await agents.agents.post(values);
      location.reload();
    } catch (err) { await alert(err.message); }
  });
  const query = new URL(location.href).searchParams, agent = query.get("agent"), session = query.get("session");
  const parts = session ? [] : agent ? ["agent", "sessions", "memories", "tools"] : ["agents", "sessions"];
  const vars = agent ? { agent } : {};
  const refresh = () => Promise.all(parts.map((part) => cms.reloadPart(nid, part, vars)));
  const timer = setInterval(() => el.isConnected ? refresh() : clearInterval(timer), 10000);
  const box = el.querySelector("[cms-part=conversation]");
  if (!box) return;
  const end = () => box.scrollTop = box.scrollHeight;
  render(box).then(end); // starts at the latest message
  // only the messages since the last one are added, so what is opened or selected stays as it is; who
  // is at the end stays there
  const poll = setInterval(async () => {
    if (!el.isConnected) return clearInterval(poll);
    const list = box.firstElementChild;
    const after = Number(list?.querySelector(":scope > [data-message]:last-child")?.dataset.message ?? 0);
    const more = document.createElement("template");
    more.innerHTML = await api.cms.node(nid).html.part("conversation").post({ vars: { session, after } }).catch(() => "");
    const added = more.content.firstElementChild?.children;
    if (!list || !added?.length) return;
    const news = [...added], atEnd = box.scrollHeight - box.scrollTop - box.clientHeight < 10;
    list.append(...news);
    await Promise.all(news.map(render));
    if (atEnd) end();
  }, 3000);
});
