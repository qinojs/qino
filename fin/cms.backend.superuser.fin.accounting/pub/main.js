import "@qino/m/core/pub/js/SettingsEditor.mjs";
import { finPanel } from "@qino/m/cms.backend.superuser.fin/pub/panel.js";

cms.initNode("backend.superuser.fin.accounting", (el) => {
  const { execute, fields } = finPanel(el);

  el.addEventListener("submit", (e) => {
    const form = e.target;
    if (form.matches("[data-book]")) execute(e.submitter, { book: fields(form) });
    else if (form.matches("[data-account]")) execute(e.submitter, { account: fields(form) });
    else return; // the filters are plain GET forms
    e.preventDefault();
  });

  el.addEventListener("click", (e) => {
    const button = e.target.closest("[data-reverse]");
    if (button) execute(button, { reverse: button.dataset.reverse });
  });
});
