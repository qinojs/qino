import "@qino/m/core/pub/js/SettingsEditor.mjs";
import { finPanel } from "../../cms.backend.fin/pub/panel.js";

cms.initNode("backend.fin.invoice.settings", (el) => {
  const { execute, fields } = finPanel(el);
  el.addEventListener("submit", (e) => {
    if (!e.target.matches("[data-css]")) return;
    e.preventDefault();
    execute(e.submitter, fields(e.target));
  });
});
