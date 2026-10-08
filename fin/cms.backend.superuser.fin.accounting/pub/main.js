import "@qino/m/core/pub/js/SettingsEditor.mjs";
import { finPanel } from "@qino/m/cms.backend.superuser.fin/pub/panel.js";

cms.initNode("backend.superuser.fin.accounting", (el) => {
  const { node, execute, fields } = finPanel(el);

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
    const exporting = e.target.closest("[data-export]");
    if (exporting) download(exporting);
  });

  /** The books of the period shown, saved as a ZIP. */
  async function download(button) {
    button.disabled = true;
    try {
      const { from, to } = fields(button.form);
      const { name, data } = await node.api.post({ export: { from, to } });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(new Blob([Uint8Array.fromBase64(data)], { type: "application/zip" }));
      link.download = name;
      link.click();
      URL.revokeObjectURL(link.href);
    } finally {
      button.disabled = false;
    }
  }
});
