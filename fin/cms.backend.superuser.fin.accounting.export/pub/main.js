import { finPanel } from "@qino/m/cms.backend.superuser.fin/pub/panel.js";

cms.initNode("backend.superuser.fin.accounting.export", (el) => {
  const { node, fields } = finPanel(el);

  // the books of the period, saved as a ZIP
  el.addEventListener("submit", async (e) => {
    const form = e.target;
    if (!form.matches("[data-export]")) return;
    e.preventDefault();
    e.submitter.disabled = true;
    try {
      const { name, data } = await node.api.post({ export: fields(form) });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(new Blob([Uint8Array.fromBase64(data)], { type: "application/zip" }));
      link.download = name;
      link.click();
      URL.revokeObjectURL(link.href);
    } finally {
      e.submitter.disabled = false;
    }
  });
});
