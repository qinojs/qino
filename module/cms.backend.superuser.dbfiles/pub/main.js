cms.initCont("cms.backend.superuser.dbfiles", async (el) => {
  const { apt } = await import(el.dataset.sysUrl + "core/pub/js/qino.js");
  const nid = cms.el.pid(el);

  let debTimer;
  el.querySelector("[data-search]")?.addEventListener("input", (e) => {
    clearTimeout(debTimer);
    debTimer = setTimeout(() => {
      const order = el.querySelector("[data-order]").value;
      location.href = "?search=" + encodeURIComponent(e.target.value) + "&order=" + order;
    }, 400);
  });

  el.querySelector("[data-order]")?.addEventListener("change", (e) => {
    location.search = "?order=" + e.target.value;
  });

  el.addEventListener("change", (e) => {
    const set = e.target.closest("[data-set]");
    if (!set) return;
    const val = set.type === "checkbox" ? (set.checked ? 1 : 0) : set.value;
    apt.cms.node(nid).html.post({ vars: { [set.dataset.set]: val } });
  });

  el.addEventListener("click", async (e) => {
    const del = e.target.closest("[data-delete]");
    if (del) {
      e.stopPropagation();
      await apt.cms.node(nid).html.post({ vars: { delete: del.dataset.delete } });
      del.closest("tr").remove();
      return;
    }
    const action = e.target.closest("[data-action]");
    if (action) {
      action.disabled = true;
      const r = await apt.cms.node(nid).html.post({ vars: { [action.dataset.action]: 1 } });
      action.disabled = false;
      alert(JSON.stringify(JSON.parse(r), null, 2));
      return;
    }
    if (e.target.closest("[data-copy-url]")) {
      navigator.clipboard.writeText(el.querySelector("[data-url]").href);
    }
  });
});
