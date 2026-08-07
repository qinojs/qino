import { api } from "../../core/pub/js/qino.js";

cms.initNode("backend.superuser.dbfiles.transform", (el) => {
  const alert = async (text) => (await import("@qino/u2/js/dialog/dialog.js")).alert(text);
  const nid = cms.el.nid(el);

  async function postVars(vars) {
    const html = await api.cms.node(nid).html.post({ vars });
    const inner = new DOMParser().parseFromString(html, "text/html").querySelector("[qcms-id]")?.innerHTML ?? html;
    try { return JSON.parse(inner); } catch { return { error: inner }; }
  }

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
        const { error } = await postVars({ install_binary: install.dataset.install });
        if (error) { await alert("Error:\n" + error); return; }
        location.reload();
      } catch (err) {
        await alert("Request failed:\n" + err);
      } finally {
        install.disabled = false;
        ico.textContent = "download_for_offline";
      }
      return;
    }

    const clear = e.target.closest("[data-clear-cache]");
    if (clear) {
      clear.disabled = true;
      try {
        const val = clear.dataset.clearCache;
        const { error } = await postVars({ clear_cache: val === "true" ? true : Number(val) });
        if (error) { await alert("Error:\n" + error); return; }
        cms.reloadPart(nid, "cache");
      } catch (err) {
        await alert("Request failed:\n" + err);
      } finally {
        clear.disabled = false;
      }
    }
  });
});
