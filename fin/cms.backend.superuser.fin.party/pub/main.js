import { finPanel } from "@qino/m/cms.backend.superuser.fin/pub/panel.js";

cms.initNode("backend.superuser.fin.party", (el) => {
  const { execute, fields } = finPanel(el);

  el.addEventListener("submit", (e) => {
    const form = e.target;
    if (form.matches("[data-create]")) execute(e.submitter, { create: fields(form) });
    else if (form.dataset.save) execute(e.submitter, { save: { ...fields(form), id: form.dataset.save } });
    else return; // the filter is a plain GET form
    e.preventDefault();
  });
});
