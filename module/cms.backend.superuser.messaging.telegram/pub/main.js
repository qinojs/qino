import { nodePanel } from "@qino/m/cms.backend/pub/js/node.mjs";

cms.initNode("backend.superuser.messaging.telegram", (el) => {
  const { execute } = nodePanel(el, ["bot", "send", "chats"]);
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
