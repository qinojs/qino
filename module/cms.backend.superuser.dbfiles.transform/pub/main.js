cms.initCont("cms.backend.superuser.dbfiles.transform", async (el) => {
  const { apt } = await import(el.dataset.sysUrl + "core/pub/js/apt.js");
  const nid = cms.el.pid(el);

  el.addEventListener("click", async (e) => {
    const copy = e.target.closest("[data-copy]");
    if (copy) {
      navigator.clipboard.writeText(copy.dataset.copy).then(() => {
        const ico = copy.querySelector("u2-ico");
        ico.textContent = "check";
        setTimeout(() => { ico.textContent = "content_copy"; }, 1200);
      });
      return;
    }

    const install = e.target.closest("[data-install]");
    if (install) {
      install.disabled = true;
      const ico = install.querySelector("u2-ico");
      ico.textContent = "hourglass_top";
      try {
        const raw = await apt.cms.node(nid).html.post({ vars: { install_binary: install.dataset.install } });
        const { output, error } = JSON.parse(raw);
        alert(error ? "Error:\n" + error : output);
        if (!error) location.reload();
      } finally {
        install.disabled = false;
        ico.textContent = "download_for_offline";
      }
      return;
    }

    const clear = e.target.closest("[data-clear-cache]");
    if (clear) {
      clear.disabled = true;
      const ico = clear.querySelector("u2-ico");
      ico.textContent = "hourglass_top";
      try {
        const raw = await apt.cms.node(nid).html.post({ vars: { clear_cache: 1 } });
        const { error } = JSON.parse(raw);
        if (error) { alert("Error:\n" + error); return; }
        cms.reloadPart(nid, "cache");
      } finally {
        clear.disabled = false;
        ico.textContent = "delete_sweep";
      }
    }
  });
});
