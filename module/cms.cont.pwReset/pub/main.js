import { api } from "@qino/pub/qino.js";

cms.initNode("cont.pwReset", (el) => {
  const node = api.cms.node(Number(cms.el.nid(el)));

  el.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.target;
    const msg = form.querySelector(".-msg");
    const button = form.querySelector("button");
    button.disabled = true;
    const vars = form.dataset.request !== undefined
      ? { request: form.elements.email.value }
      : { reset: { handle: form.elements.handle.value, pw: form.elements.pw.value } };
    try {
      const response = await node.api.post(vars);
      msg.value = response?.message || "";
      if (response?.ok) form.querySelectorAll("input, button").forEach((v) => v.disabled = true);
    } catch (e) {
      msg.value = e?.message || String(e);
      button.disabled = false;
    }
  });
});
