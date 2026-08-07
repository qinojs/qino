import { api } from "../../core/pub/js/qino.js";

cms.initNode("backend.superuser.oauth_server", (el) => {
  const node = api.cms.node(Number(cms.el.nid(el)));
  let busy = false;

  const show = async (message) => (await import("@qino/u2/js/dialog/dialog.js")).alert(message);
  const refresh = async () => {
    for (const name of ["clients", "grants"]) {
      el.querySelector(`[cms-part=${name}]`).innerHTML = await node.html.part(name).get();
    }
  };
  const execute = async (button, data) => {
    if (busy) return;
    busy = true;
    button.disabled = true;
    try {
      const response = await node.api.post(data);
      await refresh();
      await show(response?.message || "");
    } catch (e) {
      await show(e?.message || String(e));
    } finally {
      busy = false;
      button.disabled = false;
    }
  };

  el.addEventListener("click", (event) => {
    const save = event.target.closest("[data-save]");
    const del = event.target.closest("[data-delete]");
    const revoke = event.target.closest("[data-revoke]");
    if (save) {
      const form = save.closest("form");
      if (!form.reportValidity()) return;
      const field = (name) => form.elements[name].value.trim();
      execute(save, { save: { id: field("id"), name: field("name"), redirectUris: field("redirect_uris").split("\n") } });
    } else if (del) execute(del, { delete: del.dataset.delete });
    else if (revoke) execute(revoke, { revoke: { clientId: revoke.dataset.revoke, usrId: Number(revoke.dataset.usr) } });
  });
});
