import { api } from "../../core/pub/js/qino.js";

cms.initNode("backend.superuser.error_report", (el) => {
  const pid = Number(cms.el.nid(el));

  const form = el.querySelector("form");
  let timer;
  form?.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => cms.reloadPart(pid, "list", Object.fromEntries(new FormData(form))), 300);
  });

  const reload = (vars, btn) => {
    if (btn) btn.disabled = true;
    api.cms.node(pid).html.post({ vars }).then((html) => {
      el.outerHTML = html;
    });
  };

  el.addEventListener("click", (e) => {
    const delMatching = e.target.closest("[data-delete-matching]");
    if (delMatching) {
      reload({ deleteMatching: Object.fromEntries(new FormData(form)) }, delMatching);
      return;
    }

    const delGroup = e.target.closest("[data-delete-group]");
    if (delGroup) {
      reload({ deleteGroup: { ...delGroup.dataset } }, delGroup);
    }
  });
});
