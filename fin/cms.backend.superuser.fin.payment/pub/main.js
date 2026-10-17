import "@qino/m/core/pub/js/SettingsEditor.mjs";
import { finPanel } from "../../cms.backend.superuser.fin/pub/panel.js";

cms.initNode("backend.superuser.fin.payment", (el) => {
  const { execute, fields } = finPanel(el);

  el.addEventListener("submit", (e) => {
    const form = e.target;
    if (form.matches("[data-record]")) execute(e.submitter, { record: fields(form) });
    else if (form.matches("[data-refund]")) {
      execute(e.submitter, { refund: { ...fields(form), id: form.dataset.refund } });
    }
    else return; // the filter is a plain GET form
    e.preventDefault();
  });

  el.addEventListener("click", (e) => {
    const sync = e.target.closest("[data-sync]");
    if (sync) execute(sync, { sync: sync.dataset.sync });
  });
});
