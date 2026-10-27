import { api } from "@qino/pub/api.js";
import { t } from "@qino/pub/t.js";

// core asks for a fresh proof (step-up) itself before it takes the new password
cms.initNode("cont.my.password", async (el) => {
  const form = el.querySelector("form");
  if (!form) return;
  const msg = form.querySelector(".-msg");
  const done = await t`Password changed.`;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    msg.value = "";
    try {
      await api.core.password.put({ pw: form.elements.pw.value });
      form.elements.pw.value = "";
      msg.value = done;
    } catch (e) { msg.value = e?.message || String(e); }
  });
});
