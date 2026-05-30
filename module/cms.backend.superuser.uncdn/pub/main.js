cms.initCont("cms.backend.superuser.uncdn", async (el) => {
  const { apt } = await import(el.dataset.sysUrl + "core/pub/js/qino.js");
  const nid = Number(el.dataset.pid);

  el.addEventListener("click", async (e) => {
    const reload = e.target.closest("[data-reload]");
    const del = e.target.closest("[data-delete]");
    const btn = reload || del;
    if (!btn) return;
    btn.disabled = true;
    const vars = reload ? JSON.parse(reload.dataset.reload) : { delete: del.dataset.delete };
    el.outerHTML = await apt.cms.node(nid).html.post({ vars });
  });
});
