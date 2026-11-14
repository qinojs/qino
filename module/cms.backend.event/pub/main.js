import { api } from "@qino/pub/api.js";
import { t as translate } from "@qino/pub/t.js";
import { widget } from "@qino/m/cms.frontend/pub/panel/widget.js";

const t = translate.in("cms.backend.event");

cms.initNode("backend.event", (el) => {
  const ref = api.cms.node(Number(cms.el.nid(el))), status = el.querySelector("[role=status]");
  for (const target of el.querySelectorAll("[data-event-widget]")) target.replaceChildren(widget(target.dataset.widgetSrc, {
    node: { id: Number(target.dataset.eventWidget) }, content: el.querySelector("[data-event-content]"), onChange: () => {},
  }));
  if (el.querySelector("[data-event-texts]")) {
    import("@qino/u2/el/rte/rte.js");
    import("@qino/u2/js/rte/blocks.js");
  }
  const filter = el.querySelector("[data-event-filter]");
  let filterTimer, filterValue = filter && JSON.stringify(Object.fromEntries(new FormData(filter)));
  let filterQueue = Promise.resolve();
  const filterList = () => {
    clearTimeout(filterTimer);
    const vars = Object.fromEntries(new FormData(filter)), url = new URL(location.href), snapshot = JSON.stringify(vars);
    if (snapshot === filterValue) return;
    filterValue = snapshot;
    for (const key of ["view", "schedule", "page"]) url.searchParams.delete(key);
    for (const key of ["search", "category", "sort"])
      vars[key] && !(key === "sort" && vars[key] === "date") ? url.searchParams.set(key, vars[key]) : url.searchParams.delete(key);
    history.replaceState(null, "", url);
    filterQueue = filterQueue.then(() => snapshot === filterValue
      ? cms.reloadPart(Number(cms.el.nid(el)), "list", { ...vars, page: "" }) : undefined
    ).catch((error) => { filterValue = null; status.textContent = error?.message || String(error); });
  };
  filter?.addEventListener("input", (event) => {
    if (event.isComposing || event.target.type !== "search") return;
    clearTimeout(filterTimer);
    filterTimer = setTimeout(filterList, 300);
  });
  filter?.addEventListener("change", filterList);
  filter?.addEventListener("submit", (event) => { event.preventDefault(); filterList(); });
  const states = new WeakMap(), timers = new Map();
  const values = (form) => Object.fromEntries(new FormData(form));
  for (const form of el.querySelectorAll("[data-event-texts], [data-event-move]"))
    states.set(form, JSON.stringify(values(form)));
  let queue = Promise.resolve();
  const change = (control, input, snapshot) => {
    queue = queue.then(async () => {
      const output = control.querySelector("[data-save-state]") || status;
      if (snapshot && snapshot === states.get(control)) return;
      const lock = !input.texts && !input.move;
      if (lock) control.inert = true;
      try {
        output.textContent = await t`Saving…`;
        const result = await ref.api.post(input);
        if (input.texts) el.querySelector("[data-event-title]").textContent = input.texts.title;
        else if (input.move) {
          const label = el.querySelector(`[data-event-category="${input.move.event}"]`);
          if (label) label.textContent = control.elements.category.selectedOptions[0].textContent;
        } else if (input.visibility) {
          const { id, inherit } = input.visibility;
          el.querySelector(`[data-event-access="${id}"]`).textContent = await (inherit ? t`Inherited` : t`Private`);
          control.dataset.inherit = String(!inherit);
          control.textContent = await (inherit ? t`Make private` : t`Inherit category access`);
        } else if (result?.id && input.create && !input.create.category) {
          const url = new URL(location.href);
          url.searchParams.set("event", String(result.id));
          location.href = url.href;
        } else if (result?.url) {
          const url = new URL(result.url, location.href);
          url.searchParams.set("cms_editmode", "1");
          location.href = url.href;
        }
        if (snapshot) states.set(control, snapshot);
        output.textContent = await (snapshot && snapshot !== JSON.stringify(values(control)) ? t`Unsaved changes` : t`Saved`);
      } catch (error) { output.textContent = error?.message || String(error); }
      finally { if (lock) control.inert = false; }
    });
  };
  const save = (form) => {
    clearTimeout(timers.get(form));
    if (!form.checkValidity()) {
      Promise.resolve(t`Unsaved changes`).then((message) => { form.querySelector("[data-save-state]").textContent = message; });
      return;
    }
    const data = values(form), snapshot = JSON.stringify(data);
    if (form.matches("[data-event-texts]")) change(form, { texts: { ...data, id: Number(data.id) } }, snapshot);
    else if (form.matches("[data-event-move]")) change(form, { move: { event: Number(data.event), category: Number(data.category) } }, snapshot);
    else change(form, { create: { parent: Number(data.parent), title: data.title, category: data.category === "1" } });
  };
  el.addEventListener("input", (event) => {
    const form = event.target.form;
    if (event.isComposing || !form?.matches("[data-event-texts]")) return;
    clearTimeout(timers.get(form));
    timers.set(form, setTimeout(() => save(form), 500));
  });
  el.addEventListener("change", (event) => {
    const form = event.target.form;
    if (form?.matches("[data-event-texts], [data-event-move]")) save(form);
  });
  el.addEventListener("submit", (event) => {
    const form = event.target;
    if (!form.matches("[data-event-create], [data-event-move], [data-event-texts]")) return;
    event.preventDefault();
    save(form);
  });
  el.addEventListener("click", (event) => {
    const button = event.target.closest("[data-event-visibility]");
    if (button && !button.inert) change(button, { visibility: { id: Number(button.dataset.eventVisibility), inherit: button.dataset.inherit === "true" } });
  });
});
