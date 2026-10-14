import { api } from "@qino/pub/api.js";

// Mark a report done, open it again or remove it; the lists follow.
cms.initNode("backend.ai.feedback", (el) => {
  const nid = Number(cms.el.nid(el));
  const alert = async (message) => (await import("@qino/u2/js/dialog/dialog.js")).alert(message);
  // the two topic tables are one part with their own vars: each reloaded by itself
  const reload = async (table, vars) => table.innerHTML = await api.cms.node(nid).html.part("topics").post({ vars });

  el.addEventListener("click", async (e) => {
    const button = e.target.closest("[data-done], [data-open], [data-remove]");
    if (!button) return;
    const [action, id] = Object.entries(button.dataset)[0];
    button.disabled = true;
    const res = await api.cms.node(nid).api.post({ [action]: id }).catch((err) => ({ message: err.message }));
    if (!res?.ok) return button.disabled = false, alert(res?.message ?? "Error");
    const query = new URL(location.href).searchParams, only = (name) => query.get(name) ?? undefined;
    cms.reloadPart(nid, "reports", { kind: only("kind"), about: only("about"), done: only("done") });
    for (const table of el.querySelectorAll("[cms-part=topics]")) reload(table, { for: table.dataset.for });
  });
});
