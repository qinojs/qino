import { api, t } from "@qino/pub/qino.js";
import { alert } from "@qino/u2/js/dialog/dialog.js";

cms.initNode("backend.config.webapp", (el) => {
  const nid = Number(cms.el.nid(el));
  const node = api.cms.node(nid);
  const timers = new WeakMap();
  const clock = new Intl.DateTimeFormat([], { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

  const syncTime = (doc) => {
    const time = clock.format(new Date());
    for (const target of doc?.querySelectorAll("[data-webapp-time]") ?? []) target.textContent = time;
  };

  const syncPreview = () => {
    const doc = el.querySelector("[data-webapp-preview]")?.contentDocument;
    if (!doc?.body) return;
    for (const input of el.querySelectorAll("[name]")) {
      const target = doc.querySelector(`[data-webapp-value="${CSS.escape(input.name)}"]`);
      if (target) target.textContent = input.type === "checkbox" ? (input.checked ? "✓" : "—") : input.value.trim() || "—";
    }
    doc.body.dataset.display = el.querySelector('[name="display"]')?.value ?? "";
    doc.body.dataset.orientation = el.querySelector('[name="orientation"]')?.value ?? "";
    doc.body.dataset.telephone = el.querySelector('[name="telephoneDetection"]')?.checked ? "true" : "false";
    doc.body.dataset.statusBar = el.querySelector('[name="appleStatusBarStyle"]')?.value ?? "";
    syncTime(doc);
    const simulator = doc.querySelector(".WebAppPreview");
    simulator?.classList.remove("-run");
    simulator?.getBoundingClientRect();
    simulator?.classList.add("-run");
  };

  el.querySelector("[data-webapp-preview]")?.addEventListener("load", syncPreview);
  const clockTimer = setInterval(() => {
    if (!el.isConnected) return clearInterval(clockTimer);
    syncTime(el.querySelector("[data-webapp-preview]")?.contentDocument);
  }, 60_000);

  const save = async (input) => {
    if (!input.name || !input.checkValidity()) return;
    const status = input.closest(".u2-card").querySelector("[data-status]");
    status.textContent = "…";
    try {
      const value = input.type === "checkbox" ? input.checked : input.value;
      await node.api.post({ save: { [input.name]: value } });
      status.textContent = await t`Saved`;
    } catch (e) {
      status.textContent = "";
      await alert(e.message);
    }
  };

  el.addEventListener("input", (event) => {
    const input = event.target;
    if (!input.name || input.type === "checkbox" || input.tagName === "SELECT") return;
    syncPreview();
    clearTimeout(timers.get(input));
    timers.set(input, setTimeout(() => save(input), 500));
  });

  el.addEventListener("change", async (event) => {
    syncPreview();
    clearTimeout(timers.get(event.target));
    await save(event.target);
  });
});
