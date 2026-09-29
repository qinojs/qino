import { api } from "@qino/pub/api.js";

// Remove a memory that was sorted wrong; try how decide() sorts one.
cms.initNode("backend.ai1.user_memory", (el) => {
  const nid = Number(cms.el.nid(el));
  const post = (data) => api.cms.node(nid).api.post(data).catch((err) => ({ message: err.message }));
  const alert = async (message) => (await import("@qino/u2/js/dialog/dialog.js")).alert(message);

  el.addEventListener("click", async (e) => {
    const button = e.target.closest("[data-remove]");
    if (!button) return;
    const res = await post({ remove: button.dataset.remove });
    if (!res?.ok) return alert(res?.message ?? "Error");
    cms.reloadPart(nid, "list");
  });

  el.querySelector("[data-try]").addEventListener("submit", async (e) => {
    e.preventDefault();
    const output = el.querySelector("output");
    output.textContent = "…";
    const res = await post({ decide: e.target.elements.content.value });
    output.textContent = res?.ok ? `${res.result.choice}${res.result.probabilities ? ` ${JSON.stringify(res.result.probabilities)}` : ""}` : res?.message ?? "Error";
  });
});
