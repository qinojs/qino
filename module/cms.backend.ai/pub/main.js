cms.initCont("cms.backend.ai", (el) => {
  const timers = new WeakMap();
  const save = async (form) => {
    const state = form.querySelector(".ai-autosave-state");
    if (state) { state.classList.remove("-error"); state.textContent = "Saving..."; }
    try {
      const r = await fetch(location.href, { method: "POST", body: new FormData(form), credentials: "same-origin" });
      if (!r.ok) throw new Error("HTTP " + r.status);
      if (state) state.textContent = "Saved";
    } catch {
      if (state) { state.classList.add("-error"); state.textContent = "Error saving"; }
    }
  };
  const schedule = (form, delay = 600) => {
    clearTimeout(timers.get(form));
    timers.set(form, setTimeout(() => save(form), delay));
  };
  for (const form of el.querySelectorAll(".ai-provider-form")) {
    form.addEventListener("submit", (e) => { e.preventDefault(); save(form); });
    for (const field of form.querySelectorAll("input, select, textarea")) {
      if (field.type === "hidden") continue;
      field.addEventListener("input", () => schedule(form));
      field.addEventListener("change", () => schedule(form, 0));
    }
  }

  const sel = el.querySelector("select[name=default_provider]");
  const inp = el.querySelector("input[name=default_model]");
  if (sel && inp) {
    const update = () => {
      inp.setAttribute("list", "ai-models-" + sel.value.replace(/[^a-zA-Z0-9_-]/g, "-") + "-default");
      for (const d of el.querySelectorAll(".ai-provider")) {
        if (d.querySelector("summary")?.childNodes[0]?.textContent?.trim() === sel.value) d.open = true;
      }
    };
    sel.addEventListener("change", update);
    update();
  }
});
