import "@qino/m/core/pub/js/SettingsEditor.mjs";
import { finPanel } from "../../cms.backend.superuser.fin/pub/panel.js";
import { t } from "@qino/pub/t.js";

cms.initNode("backend.superuser.fin.invoice", (el) => {
  const { node, execute, fields, files } = finPanel(el);
  const form = el.querySelector("[data-edit]");

  el.addEventListener("submit", (e) => {
    const form = e.target;
    if (form.matches("[data-create]")) execute(e.submitter, { create: fields(form) });
    else if (form.dataset.request) execute(e.submitter, { request: { ...fields(form), id: form.dataset.request } });
    else if (form.dataset.record) execute(e.submitter, { record: { ...fields(form), id: form.dataset.record } });
    else if (form.dataset.send) execute(e.submitter, { send: { ...fields(form), id: form.dataset.send } });
    else if (form.dataset.sent) execute(e.submitter, { sent: { ...fields(form), id: form.dataset.sent } });
    else if (form.dataset.attach) {
      e.preventDefault();
      files(form.elements.file).then(([file]) => execute(e.submitter, { attach: { id: form.dataset.attach, file } }));
      return;
    }
    else if (!form.matches("[data-edit]")) return; // the filter is a plain GET form; the editor saves by itself
    e.preventDefault();
  });

  el.addEventListener("click", (e) => {
    const button = e.target.closest("[data-action]");
    if (button) execute(button, { action: { action: button.dataset.action, id: button.dataset.id } });
  });

  if (form) editor(form);
  el.querySelectorAll("iframe[data-sheets]").forEach(sheets);

  /** A printed document's A4 sheets, scaled down to the card's width and shown whole. */
  function sheets(frame) {
    const fit = () => {
      const doc = frame.contentDocument?.documentElement;
      if (!doc?.scrollWidth) return;
      doc.style.zoom = "";
      const zoom = Math.min(1, frame.clientWidth / doc.scrollWidth);
      //frame.style.height = `${Math.ceil(doc.scrollHeight * zoom)}px`;
      doc.style.zoom = String(zoom);
    };
    frame.addEventListener("load", fit);
    new ResizeObserver(fit).observe(frame);
    fit();
  }

  /** A draft: saved a moment after each change, and the preview drawn from what was saved. */
  function editor(form) {
    const preview = el.querySelector("[data-preview]");
    const state = el.querySelector("[data-state]");
    const lines = form.querySelector("[data-lines]");
    const template = form.querySelector("template[data-line]");
    let next = lines.children.length; // a new line's fields get numbers not used yet
    let timer, saving = Promise.resolve();

    const save = () => {
      saving = saving.then(async () => {
        state.textContent = "…";
        try {
          const answer = await node.api.post({ save: { ...fields(form), id: form.dataset.edit } });
          if (answer?.ok === false) { state.textContent = answer.message; return; }
          preview.srcdoc = answer.html;
          state.textContent = "✓";
        } catch (e) {
          state.textContent = e?.message || String(e);
        }
      });
    };
    const soon = () => { clearTimeout(timer); timer = setTimeout(save, 600); };

    form.addEventListener("input", soon);
    // the PDF of what was saved, in a tab of its own: opened at the click, or the browser blocks it
    el.querySelector("[data-pdf]")?.addEventListener("click", async () => {
      const tab = globalThis.open("about:blank");
      clearTimeout(timer);
      save();
      await saving;
      try {
        const answer = await node.api.post({ pdf: form.dataset.edit });
        tab.location = URL.createObjectURL(new Blob([Uint8Array.fromBase64(answer.pdf)], { type: "application/pdf" }));
      } catch (e) {
        tab?.close();
        state.textContent = e?.message || String(e);
      }
    });
    // dynamic: the drag attributes pull a cdn dependency that `deno check --all` cannot follow
    import("@qino/u2/attr/dropzone/dropzone.js");
    import("@qino/u2/attr/draghandle/draghandle.js");
    // a line moved: the order of the fields is the order of the lines
    lines.addEventListener("u2-dropzone-drop", (e) => e.detail?.add && soon());

    // a user picked: the invoice is theirs and takes their name and address — over what is typed
    // already only when asked
    form.querySelector("[data-user]")?.addEventListener("change", (e) => e.target.value && take(e.target.value));
    const take = async (id) => {
      const { lang, ...address } = await node.api.post({ usr: id });
      const fields = Object.entries(address).filter(([name]) => form.elements[name]);
      const typed = fields.some(([name, value]) =>
        form.elements[name].value.trim() && form.elements[name].value !== value);
      const { confirm } = await import("@qino/u2/js/dialog/dialog.js");
      if (!typed || await confirm(await t`Take over the user's name and address?`)) {
        for (const [name, value] of fields) form.elements[name].value = value;
        // the user's language, where the invoice can be written in it
        if ([...form.elements.lang.options].some((o) => o.value === lang)) form.elements.lang.value = lang;
      }
      soon();
    };
    form.addEventListener("click", (e) => {
      if (e.target.closest("[data-add-line]")) {
        lines.insertAdjacentHTML("beforeend", template.innerHTML.replaceAll("__i__", String(next++)));
        lines.lastElementChild.querySelector("input")?.focus();
      } else if (e.target.closest("[data-remove-line]")) {
        e.target.closest("tr").remove();
        soon();
      }
    });
  }
});
