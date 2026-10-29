import { nodePanel } from "@qino/m/cms.backend/pub/js/node.mjs";

cms.initNode("backend.superuser.oauth_server", (el) => {
  const { execute } = nodePanel(el, ["clients", "grants"]);

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
