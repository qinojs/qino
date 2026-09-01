import { api } from "@qino/pub/api.js";

cms.initNode("backend.system", (el) => {
  const d = new Date();
  const off = -d.getTimezoneOffset() / 60;
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60_000);
  const tr = el.querySelector(".-browser-time")?.closest("tr");
  if (tr) {
    tr.querySelector(".-browser-time").textContent = local.toISOString().slice(0, 19).replace("T", " ");
    tr.querySelector(".-browser-tz").textContent = `UTC${off < 0 ? "" : "+"}${off}`;
  }

  const alert = async (text) => (await import("@qino/u2/js/dialog/dialog.js")).alert(text);
  const nid = cms.el.nid(el);
  const node = api.cms.node(nid);

  // one after another: every check re-collects the registry, so parallel runs only pile up load
  (async () => {
    for (const box of el.querySelectorAll(".healty_item[data-item]")) {
      const inner = await node.html.part("health-item").post({ vars: { type: box.dataset.type, item: box.dataset.item } });
      if (!inner.trim()) { box.remove(); continue; }
      box.innerHTML = inner;
      box.classList.add("-" + box.dataset.type);
    }
    if (!el.querySelector(".healty_item")) el.querySelector(".-allok")?.removeAttribute("hidden");
  })();

  el.addEventListener("click", async (e) => {
    const load = e.target.closest("button[data-load-part]");
    if (load) {
      load.disabled = true;
      cms.reloadPart(nid, load.dataset.loadPart);
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
    const result = await node.api.post({ solve_health_item: { type, item, solution, formData } });
    btn.disabled = false;

    result?.done ? btn.closest(".healty_item").remove() : await alert("failed?");
    if (result?.response) await alert(result.response);
  });
});
