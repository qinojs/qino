import { finPanel } from "../../cms.backend.superuser.fin/pub/panel.js";

cms.initNode("backend.superuser.fin.bank", (el) => {
  const { execute, fields } = finPanel(el);

  el.addEventListener("submit", async (e) => {
    const form = e.target;
    if (form.matches("[data-camt]")) {
      e.preventDefault();
      // statements are small XML files: read here, sent as text
      const texts = await Promise.all([...form.elements.file.files].map((file) => file.text()));
      execute(e.submitter, { camt: texts });
    } else if (form.dataset.assign) {
      e.preventDefault();
      execute(e.submitter, { assign: { ...fields(form), id: form.dataset.assign } });
    } // the filter is a plain GET form
  });
});
