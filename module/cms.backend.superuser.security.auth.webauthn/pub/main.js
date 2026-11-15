import { cms } from "@qino/m/cms/pub/js/cms.mjs";
import { api } from "@qino/pub/api.js";
import { alert } from "@qino/u2/js/dialog/dialog.js";

// Deleting goes through the api, which asks for a fresh proof first (step-up).
cms.initNode("backend.superuser.security.auth.webauthn", (el) => {
  const nid = Number(cms.el.nid(el));
  el.addEventListener("submit", async (e) => {
    const form = e.target.closest("[data-delete]");
    if (!form) return;
    e.preventDefault();
    try {
      await api.cms.node(nid).api.post({ delete: form.dataset.delete });
      form.closest("tr").remove();
    } catch (err) { await alert(err.message); }
  });
});
