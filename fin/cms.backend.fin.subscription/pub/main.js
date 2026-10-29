import "@qino/m/core/pub/js/SettingsEditor.mjs";
import { finPanel } from "../../cms.backend.superuser.fin/pub/panel.js";

cms.initNode("backend.superuser.fin.subscription", (el) => {
  const { execute, fields } = finPanel(el);

  el.addEventListener("submit", (e) => {
    const form = e.target;
    if (form.matches("[data-subscribe]")) execute(e.submitter, { subscribe: fields(form) });
    else if (form.dataset.update) execute(e.submitter, { update: { ...fields(form), id: form.dataset.update } });
    else if (form.matches("[data-plan]")) execute(e.submitter, { plan: { ...fields(form), id: form.dataset.plan } });
    else return; // the filter is a plain GET form
    e.preventDefault();
  });

  el.addEventListener("click", (e) => {
    const button = e.target.closest("[data-action]");
    if (button) execute(button, { [button.dataset.action]: button.dataset.id || true });
  });
});
