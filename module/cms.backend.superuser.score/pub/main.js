import { api } from "../../core/pub/js/qino.js";

cms.initNode("backend.superuser.score", (el) => {
  const node = api.cms.node(Number(cms.el.nid(el)));
  const list = el.querySelector("[cms-part=list]");

  const show = async (message) => (await import("@qino/u2/js/dialog/dialog.js")).alert(message);
  const refresh = async () => {
    list.innerHTML = await node.html.part("list").get();
  };

  el.addEventListener("click", async (event) => {
    const prune = event.target.closest("[data-prune]");
    const reload = event.target.closest("[data-refresh]");
    if (!prune && !reload) return;
    const button = prune ?? reload;
    button.disabled = true;
    try {
      if (prune) await show((await node.api.post({ prune: true }))?.message || "");
      await refresh();
    } catch (e) {
      await show(e?.message || String(e));
    } finally {
      button.disabled = false;
    }
  });
});
