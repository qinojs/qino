import { apt } from "../../core/pub/js/qino.js";

cms.initNode("backend.system", (el) => {
  const d = new Date();
  const off = -d.getTimezoneOffset() / 60;
  const tr = el.querySelector(".-browser-time")?.closest("tr");
  if (tr) {
    tr.querySelector(".-browser-time").textContent = d.toISOString().slice(0, 19).replace("T", " ");
    tr.querySelector(".-browser-tz").textContent = "UTC+" + off;
  }

  const alert = async (text) => (await import("@qino/u2/js/dialog/dialog.js")).alert(text);
  const nid = cms.el.nid(el);

  el.addEventListener("click", async (e) => {
    const load = e.target.closest("button[data-load-part]");
    if (load) {
      load.disabled = true;
      load.closest("[data-part]").innerHTML = await apt.cms.node(nid).html.part(load.dataset.loadPart).get();
      return;
    }

    const btn = e.target.closest("button[data-solution]");
    if (!btn) return;
    e.preventDefault();
    const type     = btn.closest("[data-type]").getAttribute("data-type");
    const item     = btn.closest("[data-item]").getAttribute("data-item");
    const solution = btn.getAttribute("data-solution");
    const form     = btn.closest("form");
    const formData = form ? Object.fromEntries(new FormData(form)) : {};

    btn.disabled = true;
    const result = await apt.cms.node(nid).api.post({ solve_health_item: { type, item, solution, formData } });
    btn.disabled = false;

    if (result?.done) {
      btn.closest(".healty_item").remove();
    } else {
      await alert("failed?");
    }
    if (result?.response) await alert(result.response);
  });
});
