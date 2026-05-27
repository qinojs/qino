const { apt } = await import(sysURL + "core/pub/js/apt.js");

cms.initCont("cms.backend.superuser.error_report", async (el) => {
  const pid = Number(el.dataset.pid);

  const reload = (vars, btn) => {
    if (btn) btn.disabled = true;
    apt.cms.node(pid).html.post({ vars }).then((html) => {
      el.outerHTML = html;
    });
  };

  el.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-reload]");
    if (btn) {
      reload(JSON.parse(btn.dataset.reload), btn);
      return;
    }

    const del = e.target.closest("[data-delete-entry]");
    if (del) {
      apt.cms.node(pid).html.post({ vars: { delete: Object.assign({}, del.dataset) } }).then((html) => {
        el.outerHTML = html;
      });
    }
  });
});
