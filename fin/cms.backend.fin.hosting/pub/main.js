import { finPanel } from "../../cms.backend.superuser.fin/pub/panel.js";

cms.initNode("backend.superuser.fin.hosting", (el) => {
  const { execute, fields } = finPanel(el);

  el.addEventListener("submit", (e) => {
    const form = e.target;
    if (form.dataset.save !== undefined) execute(e.submitter, { save: { ...fields(form), id: form.dataset.save } });
    else if (form.dataset.link) execute(e.submitter, { link: { ...fields(form), id: form.dataset.link } });
    else if (form.dataset.source !== undefined) execute(e.submitter, { source: fields(form) });
    else return; // the filter is a plain GET form
    e.preventDefault();
  });

  el.addEventListener("click", (e) => {
    if (e.target.closest("[data-sync]")) return execute(e.target.closest("[data-sync]"), { sync: true });
    const fold = e.target.closest("[data-aliases]");
    if (fold) {
      for (const row of el.querySelectorAll(`[data-alias-of="${CSS.escape(fold.dataset.aliases)}"]`)) row.hidden = !row.hidden;
      return;
    }
    const source = e.target.closest("[data-remove-source]");
    if (source) return execute(source, { removeSource: source.dataset.removeSource });
    if (e.target.closest("[data-prune]")) return execute(e.target.closest("[data-prune]"), { prune: true });
    const button = e.target.closest("[data-remove], [data-unlink]");
    if (!button) return;
    if (button.dataset.remove) execute(button, { remove: button.dataset.remove });
    else execute(button, { unlink: { id: button.closest("[data-domain]").dataset.domain, subscription: button.dataset.unlink } });
  });
});
