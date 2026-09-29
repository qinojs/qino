import { api } from "@qino/pub/api.js";

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
    const [{ modal }, body] = await Promise.all([
      import("@qino/u2/js/dialog/dialog.js"),
      api.cms.node(nid).html.part("conversation").post({ vars: { session: row.dataset.session } }),
    ]);
    await modal({ body: `<h3>${row.dataset.session}</h3>${body}`, root: el, buttons: [{ title: "×", value: null }] });
  });
});
