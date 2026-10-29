import { cms } from "@qino/m/cms/pub/js/cms.mjs";
import { api } from "@qino/pub/api.js";

cms.initNode("backend.superuser.auth.api_keys", (el) => {
  const nid = Number(cms.el.nid(el));
  el.addEventListener("change", async (e) => {
    const user = e.target.closest("[data-create] select[name=usr_id]");
    if (!user) return;
    const button = user.form.querySelector("button");
    const msg = el.querySelector("[data-message]");
    user.disabled = true;
    button.disabled = true;
    msg.value = "";
    try {
      await cms.reloadPart(nid, "list", { usr_id: user.value });
    } catch (err) { msg.value = err.message; }
    finally {
      user.disabled = false;
      button.disabled = !user.value;
    }
  });

  el.addEventListener("submit", async (e) => {
    const form = e.target.closest("[data-create]");
    if (!form) return;
    e.preventDefault();
    const user = form.elements.usr_id;
    const button = form.querySelector("button");
    const msg = el.querySelector("[data-message]");
    const token = el.querySelector("[data-token]");
    const create = Object.fromEntries(new FormData(form));
    button.disabled = true;
    user.disabled = true;
    msg.value = "";
    try {
      const result = await api.cms.node(nid).api.post({ create });
      token.querySelector("code").textContent = result.token;
      token.hidden = false;
      form.elements.name.value = "";
      await cms.reloadPart(nid, "list", { usr_id: user.value });
    } catch (err) { msg.value = err.message; }
    finally {
      user.disabled = false;
      button.disabled = !user.value;
    }
  });
});
