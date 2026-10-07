import { finPanel } from "@qino/m/cms.backend.superuser.fin/pub/panel.js";

cms.initNode("backend.superuser.fin.invoice.inbox", (el) => {
  const { execute, files } = finPanel(el);

  el.addEventListener("submit", async (e) => {
    const form = e.target;
    if (!form.matches("[data-read]")) return;
    e.preventDefault();
    execute(e.submitter, { read: await files(form.elements.files) });
  });
});
