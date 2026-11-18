import { api } from "@qino/pub/api.js";
import { t as translate } from "@qino/pub/t.js";
import { widget } from "@qino/m/cms.frontend/pub/panel/widget.js";
import { cms, initNode } from "@qino/m/cms/pub/js/cms.js";

const t = translate.in("cms.backend.event");

initNode("backend.event", (el) => {
  const ref = api.cms.node(Number(cms.el.nid(el))), status = el.querySelector("[role=status]");
  // through this page's api: the event may be shown by any module, whose own api knows nothing of it
  for (const target of el.querySelectorAll("[data-event-widget]")) {
    const id = Number(target.dataset.eventWidget);
    target.replaceChildren(widget(target.dataset.widgetSrc, {
      node: { id }, cards: true, onChange: () => {}, post: (input) => ref.api.post({ event: { id, ...input } }),
    }));
  }
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
    url.searchParams.delete("page");
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
  const saveState = (control) => [...(control.elements || [])].find((field) => field.matches("[data-save-state]"))
    || control.parentElement.querySelector("[role=status]") || status;
  const change = (control, input, snapshot) => {
    queue = queue.then(async () => {
      const output = saveState(control);
      if (snapshot && snapshot === states.get(control)) { output.textContent = await t`Saved`; return; }
      const lock = !!input.create;
      if (lock) control.inert = true;
      try {
        output.textContent = await t`Saving…`;
        const result = await ref.api.post(input);
        if (input.texts) {
          const title = el.querySelector("[data-event-title]");
          if (title.dataset.lang === input.texts.lang) title.textContent = input.texts.title;
        } else if (input.create) {
          const url = new URL(location.href);
          url.searchParams.set("id", result.id);
          location.href = url.href;
        }
        if (snapshot) states.set(control, snapshot);
        output.textContent = await (snapshot && snapshot !== JSON.stringify(values(control)) ? t`Unsaved changes` : t`Saved`);
      } catch (error) { output.textContent = error?.message || String(error); }
      finally { if (lock) control.inert = false; }
    });
    return queue;
  };
  const save = (form) => {
    clearTimeout(timers.get(form));
    if (!form.checkValidity()) {
      Promise.resolve(t`Unsaved changes`).then((message) => { saveState(form).textContent = message; });
      return;
    }
    const data = values(form), snapshot = JSON.stringify(data);
    if (form.matches("[data-event-texts]")) return change(form, { texts: { ...data, id: Number(data.id) } }, snapshot);
    else if (form.matches("[data-event-move]")) return change(form, { move: { event: Number(data.event), category: Number(data.category) } }, snapshot);
    else return change(form, { create: { parent: Number(data.parent), title: data.title } });
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
});
