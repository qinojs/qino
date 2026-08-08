import { api } from "../../core/pub/js/qino.js";

cms.initNode("backend.superuser.telegram", (el) => {
  const node = api.cms.node(Number(cms.el.nid(el)));
  let busy = false;

  const show = async (message) => (await import("@qino/u2/js/dialog/dialog.js")).alert(message);
  const refresh = () => Promise.all(["bot", "send", "chats"].map(async (name) => {
    el.querySelector(`[cms-part=${name}]`).innerHTML = await node.html.part(name).get();
  }));
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
  // the button's own form, validated — null when invalid
  const form = (button) => {
    const el = button.closest("form");
    return el.reportValidity() ? el.elements : null;
  };

  el.addEventListener("click", (event) => {
    const send = event.target.closest("[data-send]");
    const test = event.target.closest("[data-test]");
    const del = event.target.closest("[data-delete]");
    const tokenSave = event.target.closest("[data-token-save]");
    const webhookSet = event.target.closest("[data-webhook-set]");
    const webhookDelete = event.target.closest("[data-webhook-delete]");
    if (tokenSave) {
      const f = form(tokenSave);
      if (f) execute(tokenSave, { botToken: f.botToken.value.trim() });
    } else if (send) {
      const f = form(send);
      if (f) execute(send, { send: { to: f.to.value, text: f.text.value.trim(), html: f.html.checked } });
    } else if (webhookSet) execute(webhookSet, { webhookSet: true });
    else if (webhookDelete) execute(webhookDelete, { webhookDelete: true });
    else if (test) execute(test, { test: test.dataset.test });
    else if (del) execute(del, { delete: del.dataset.delete });
  });
});
