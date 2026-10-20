import { finPanel } from "../../cms.backend.superuser.fin/pub/panel.js";

cms.initNode("backend.superuser.fin.hosting", (el) => {
  const { execute, fields } = finPanel(el);

  el.addEventListener("submit", (e) => {
    const form = e.target;
    if (form.dataset.save !== undefined) execute(e.submitter, { save: { ...fields(form), id: form.dataset.save } });
    else if (form.dataset.link) execute(e.submitter, { link: { ...fields(form), id: form.dataset.link } });
    else return; // the filter is a plain GET form
    e.preventDefault();
  });

  el.addEventListener("click", (e) => {
    const button = e.target.closest("[data-remove], [data-unlink]");
    if (!button) return;
    if (button.dataset.remove) execute(button, { remove: button.dataset.remove });
    else execute(button, { unlink: button.dataset.unlink });
  });
});
