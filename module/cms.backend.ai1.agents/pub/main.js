import { api } from "@qino/pub/api.js";
import { markdown } from "@qino/m/cms.backend.ai1/pub/markdown.js";

/** The answers in `box` as markdown. */
const render = async (box) => {
  for (const div of box.querySelectorAll("[data-md]")) div.innerHTML = await markdown(div.textContent);
};

// The tables follow what is going on, every few seconds while the page is open: the list of agents and
// all sessions, an agent's page (`?agent=`), or a session's (`?session=`) whose conversation follows along.
cms.initNode("backend.ai1.agents", (el) => {
  const nid = Number(cms.el.nid(el));
  const query = new URL(location.href).searchParams, agent = query.get("agent"), session = query.get("session");
  const parts = session ? ["session"] : agent ? ["agent", "sessions", "memories"] : ["agents", "sessions"];
  const vars = session ? { session } : agent ? { agent } : {};
  const refresh = () => Promise.all(parts.map((part) => cms.reloadPart(nid, part, vars)));
  const timer = setInterval(() => el.isConnected ? refresh() : clearInterval(timer), 10000);
  const box = el.querySelector("[cms-part=conversation]");
  if (!box) return;
  render(box);
  // only the messages since the last one are added, so what is opened or selected stays as it is
  const poll = setInterval(async () => {
    if (!el.isConnected) return clearInterval(poll);
    const list = box.firstElementChild;
    const after = Number(list?.querySelector(":scope > [data-message]:last-child")?.dataset.message ?? 0);
    const more = document.createElement("template");
    more.innerHTML = await api.cms.node(nid).html.part("conversation").post({ vars: { session, after } }).catch(() => "");
    const added = more.content.firstElementChild?.children;
    if (!list || !added?.length) return;
    const news = [...added];
    list.append(...news);
    for (const message of news) render(message);
  }, 3000);
});
