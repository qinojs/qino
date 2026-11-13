import { nodePanel } from "@qino/m/cms.backend/pub/js/node.mjs";

cms.initNode("backend.newsletter", (el) => {
  const form = el.querySelector("form[data-issue]");
  if (!form) return; // only the draft editor previews and schedules
  const { node, alert } = nodePanel(el);
  const frame = el.querySelector(".-frame");
  const id = Number(form.dataset.issue);

  // the draft saves itself as it is edited; the button stays for Enter and pages without script
  form.save.hidden = true;
  let pending;
  const store = async () => {
    clearTimeout(pending);
    pending = null;
    const fields = { id, grp: form.grp.value, title: form.title.value, text: form.text.value, template: form.template.value };
    await node.api.post({ save: fields }).catch((e) => alert(e?.message || String(e)));
  };
  const later = () => { clearTimeout(pending); pending = setTimeout(store, 800); };
  form.addEventListener("input", (event) => { if (event.target.closest("u2-fields, u2-rte")) later(); });
  form.addEventListener("change", (event) => { if (event.target.closest("u2-fields")) later(); });
  // leaving with unsaved typing: save at once
  document.addEventListener("visibilitychange", () => { if (document.hidden && pending) store(); });
  form.addEventListener("submit", () => clearTimeout(pending)); // the post carries the fields itself

  // the server knows the template; it renders, the page only shows
  let timer;
  const refresh = () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const answer = await node.api.post({ preview: { text: form.text.value, template: form.template.value } }).catch(() => null);
      if (answer) frame.srcdoc = answer.html;
    }, 400);
  };
  form.addEventListener("input", (event) => { if (event.target === form.text) refresh(); });
  form.template.addEventListener("change", refresh);

  // only ahead: the picker starts at the next minute, in local time like its value
  const ahead = () => {
    const next = new Date(Date.now() + 60000 - new Date().getTimezoneOffset() * 60000);
    form.when.min = next.toISOString().slice(0, 16);
  };
  ahead();
  form.when.addEventListener("focus", ahead);

  // the picker is local time; the server gets the moment
  form.addEventListener("submit", (event) => {
    form.at.value = form.when.value ? String(Math.floor(new Date(form.when.value).getTime() / 1000)) : "";
    if (event.submitter?.name === "schedule" && !(Number(form.at.value) > Date.now() / 1000)) {
      event.preventDefault();
      form.when.focus();
    }
  });
});
