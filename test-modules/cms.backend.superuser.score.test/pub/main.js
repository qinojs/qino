// @ts-expect-error Browser imports resolve in the flattened /m/<module>/ namespace.
import { apt } from "../../core/pub/js/qino.js";

cms.initNode("backend.superuser.score.test", (el) => {
  const node = apt.cms.node(Number(cms.el.nid(el)));
  const list = el.querySelector("[cms-part=list]");

  const show = async (message) => (await import("@qino/u2/js/dialog/dialog.js")).alert(message);
  const refresh = async () => {
    list.innerHTML = await node.html.part("list").get();
  };

  el.addEventListener("click", async (event) => {
    const clear = event.target.closest("[data-clear]");
    const reload = event.target.closest("[data-refresh]");
    if (!clear && !reload) return;
    const button = clear ?? reload;
    button.disabled = true;
    try {
      if (clear) await show((await node.api.post({ clear: true }))?.message || "");
      await refresh();
    } catch (e) {
      await show(e?.message || String(e));
    } finally {
      button.disabled = false;
    }
  });
});
