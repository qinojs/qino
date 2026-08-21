import { nodePanel } from "@qino/m/cms.backend/pub/js/node.mjs";

cms.initNode("backend.superuser.messaging.telegram", (el) => {
  const { execute } = nodePanel(el, ["bot", "send", "chats"]);

  el.addEventListener("submit", (event) => {
    event.preventDefault();
    const button = event.submitter;
    const fields = event.target.elements;
    button.matches("[data-token-save]")
      ? execute(button, { botToken: fields.botToken.value.trim() })
      : execute(button, { send: { to: fields.to.value, text: fields.text.value.trim(), html: fields.html.checked } });
  });

  el.addEventListener("click", (event) => {
    const test = event.target.closest("[data-test]");
    const del = event.target.closest("[data-delete]");
    const webhookSet = event.target.closest("[data-webhook-set]");
    const webhookDelete = event.target.closest("[data-webhook-delete]");
    if (webhookSet) execute(webhookSet, { webhookSet: true });
    else if (webhookDelete) execute(webhookDelete, { webhookDelete: true });
    else if (test) execute(test, { test: test.dataset.test });
    else if (del) execute(del, { delete: del.dataset.delete });
  });
});
