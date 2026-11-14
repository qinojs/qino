import { api } from "@qino/pub/api.js";

cms.initNode("backend.event", (el) => {
  const ref = api.cms.node(Number(cms.el.nid(el))), status = el.querySelector("[role=status]");
  let busy = false;
  const change = async (control, input) => {
    if (busy) return;
    busy = true;
    control.inert = true;
    try {
      const result = await ref.api.post(input);
      if (result?.url) {
        const url = new URL(result.url, location.href);
        url.searchParams.set("cms_editmode", "1");
        location.href = url.href;
      } else await cms.reloadNode(Number(cms.el.nid(el)));
    } catch (error) { status.textContent = error?.message || String(error); }
    finally { busy = false; control.inert = false; }
  };
  el.addEventListener("submit", (event) => {
    const form = event.target;
    if (!form.matches("[data-event-create], [data-event-move]")) return;
    event.preventDefault();
    const values = Object.fromEntries(new FormData(form));
    if (form.matches("[data-event-create]")) change(form, { create: { parent: Number(values.parent), title: values.title, category: values.category === "1" } });
    else change(form, { move: { event: Number(values.event), category: Number(values.category) } });
  });
  el.addEventListener("click", (event) => {
    const button = event.target.closest("[data-event-visibility]");
    if (button) change(button, { visibility: { id: Number(button.dataset.eventVisibility), inherit: button.dataset.inherit === "true" } });
  });
});
