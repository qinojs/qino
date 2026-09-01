import { api } from "@qino/pub/api.js";

cms.initNode("backend.ai", (el) => {
  const nid = Number(cms.el.nid(el));
  const node = api.cms.node(nid);

  // the key field starts readonly so password managers leave it alone
  el.addEventListener("focusin", (e) => {
    if (e.target.name === "api_key") e.target.removeAttribute("readonly");
  });

  const filters = () => ({
    filterProvider: el.querySelector("#ai-filter-provider")?.value ?? "",
    filterKind: el.querySelector("#ai-filter-kind")?.value ?? "",
    filterSearch: el.querySelector("#ai-filter-search")?.value ?? "",
  });
  // Re-render the whole node, preserving the active model filter.
  const reload = (vars) => cms.reloadNode(nid, { ...filters(), ...vars });

  // Provider settings: debounced autosave (persist only, no re-render → keep focus).
  const timers = new WeakMap();
  const save = async (form) => {
    const state = form.querySelector(".ai-autosave-state");
    if (state) { state.classList.remove("-error"); state.textContent = "Saving…"; }
    try {
      await node.html.post({ vars: { action: "save-provider", provider_id: form.dataset.provider, ...Object.fromEntries(new FormData(form)) } });
      if (state) state.textContent = "Saved";
    } catch {
      if (state) { state.classList.add("-error"); state.textContent = "Error saving"; }
    }
  };
  for (const form of el.querySelectorAll(".ai-provider-form")) {
    form.addEventListener("submit", (e) => { e.preventDefault(); save(form); });
    for (const field of form.querySelectorAll("input")) {
      field.addEventListener("input", () => { clearTimeout(timers.get(form)); timers.set(form, setTimeout(() => save(form), 600)); });
      field.addEventListener("change", () => save(form));
    }
  }

  // Add provider / add model forms.
  el.addEventListener("submit", (e) => {
    const addProvider = e.target.closest?.(".ai-add-provider");
    if (addProvider) {
      e.preventDefault();
      const endpoint = addProvider.endpoint.value.trim();
      if (!endpoint) return;
      let name; try { name = new URL(endpoint).host.replace(/^api\./, ""); } catch { name = endpoint; }
      reload({ action: "add-provider", endpoint, open: name });
      return;
    }
    const addModel = e.target.closest?.(".ai-add-model");
    if (addModel) {
      e.preventDefault();
      reload({ action: "add-model", provider_id: addModel.dataset.provider, ...Object.fromEntries(new FormData(addModel)) });
    }
  });

  // Action buttons: sync / remove / set-default / delete (u2-confirm handles confirmation).
  el.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    reload({ action: btn.dataset.action, provider_id: btn.dataset.provider, model_id: btn.dataset.model, kind: btn.dataset.kind });
  });

  // Per-model kind <select> → set-kind.
  el.addEventListener("change", (e) => {
    const sel = e.target.closest("select[data-action]");
    if (sel) reload({ action: sel.dataset.action, provider_id: sel.dataset.provider, model_id: sel.dataset.model, kind: sel.value });
  });

  // Filters → reload only the models part.
  const applyFilter = () => cms.reloadPart(nid, "models", filters());
  let searchTimer;
  el.querySelector("#ai-filter-provider")?.addEventListener("change", applyFilter);
  el.querySelector("#ai-filter-kind")?.addEventListener("change", applyFilter);
  el.querySelector("#ai-filter-search")?.addEventListener("input", () => { clearTimeout(searchTimer); searchTimer = setTimeout(applyFilter, 250); });
});
