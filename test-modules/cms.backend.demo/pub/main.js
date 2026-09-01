// @ts-expect-error Browser imports resolve in the flattened /m/<module>/ namespace.
import { api } from "@qino/pub/api.js";

cms.initNode("backend.demo", (el) => {
  const node = api.cms.node(Number(cms.el.nid(el)));
  const part = el.querySelector("[cms-part=status]");
  const show = async (message) => (await import("@qino/u2/js/dialog/dialog.js")).alert(message);

  const run = async (button, vars) => {
    button.disabled = true;
    try {
      const result = await node.api.post(vars);
      await show(result?.message || "");
      part.innerHTML = await node.html.part("status").get();
    } catch (e) {
      await show(e?.message || String(e));
    } finally {
      button.disabled = false;
    }
  };

  el.addEventListener("click", (event) => {
    const fill = event.target.closest("[data-fill]");
    const button = fill ?? event.target.closest("[data-wipe]");
    if (!button) return;
    const only = [...el.querySelectorAll("input[name=seeder]:checked")].map((input) => input.value);
    run(button, fill ? { fill: true, only, scale: el.querySelector("[name=scale]").value } : { wipe: true });
  });
});
