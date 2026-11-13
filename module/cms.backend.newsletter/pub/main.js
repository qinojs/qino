import { nodePanel } from "@qino/m/cms.backend/pub/js/node.mjs";

cms.initNode("backend.newsletter", (el) => {
  const form = el.querySelector("form[data-issue]");
  if (!form) return; // only the draft editor previews and schedules
  const { node } = nodePanel(el);
  const frame = el.querySelector(".-frame");

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
