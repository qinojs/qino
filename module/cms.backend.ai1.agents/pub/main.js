import { api } from "@qino/pub/api.js";
import { markdown } from "@qino/m/cms.backend.ai1/pub/markdown.js";

/** The answers in `box` as markdown. */
const render = async (box) => {
  for (const div of box.querySelectorAll("[data-md]")) div.innerHTML = await markdown(div.textContent);
};

// A click on an agent shows only its sessions and its memories, on a session its conversation. The
// tables follow what is going on, every few seconds while the page is open.
cms.initNode("backend.ai1.agents", (el) => {
  const nid = Number(cms.el.nid(el));
  let agent = "";
  const chosen = () => Promise.all(["sessions", "memories"].map((part) => cms.reloadPart(nid, part, { agent })));
  const refresh = () => Promise.all([cms.reloadPart(nid, "agents"), chosen()]);
  const timer = setInterval(() => el.isConnected ? refresh() : clearInterval(timer), 10000);

  el.addEventListener("click", async (e) => {
    const row = e.target.closest("[data-agent], [data-session]");
    if (!row) return;
    e.preventDefault();
    if ("agent" in row.dataset) {
      agent = row.dataset.agent;
      el.querySelector("[data-all]").hidden = !agent;
      return chosen();
    }
    const session = row.dataset.session;
    const load = (after = 0) => api.cms.node(nid).html.part("conversation").post({ vars: { session, after } });
    const [{ modal }, body] = await Promise.all([import("@qino/u2/js/dialog/dialog.js"), load()]);
    let box;
    // an open conversation follows along: only the messages since the last one are added, so what is
    // opened or selected stays as it is
    const poll = setInterval(async () => {
      const list = box?.firstElementChild;
      const after = Number(list?.querySelector(":scope > [data-message]:last-child")?.dataset.message ?? 0);
      const more = document.createElement("template");
      more.innerHTML = await load(after).catch(() => "");
      const added = more.content.firstElementChild?.children;
      if (!list || !added?.length) return;
      const news = [...added];
      list.append(...news);
      for (const message of news) render(message);
    }, 3000);
    await modal({
      body: `<h3>${session}</h3><div>${body}</div>`, root: el, buttons: [{ title: "×", value: null }],
      init: (dialog) => render(box = dialog.querySelector("h3 + div")),
    });
    clearInterval(poll);
  });
});
