import { nodePanel } from "@qino/m/cms.backend/pub/js/node.mjs";

cms.initNode("backend.superuser.messaging.webpush", (el) => {
  const { execute } = nodePanel(el, ["channels", "send", "subscriptions"]);
  // the button's own form, validated, with its trimmed values — null when invalid
  const form = (button) => {
    const el = button.closest("form");
    return el.reportValidity() ? (name) => el.elements[name].value.trim() : null;
  };

  el.addEventListener("click", (event) => {
    const send = event.target.closest("[data-send]");
    const test = event.target.closest("[data-test]");
    const del = event.target.closest("[data-delete]");
    const channelAdd = event.target.closest("[data-channel-add]");
    const channelDelete = event.target.closest("[data-channel-delete]");
    if (send) {
      const field = form(send);
      if (field) execute(send, { send: { to: field("to"), title: field("title"), body: field("body"), url: field("url") } });
    } else if (channelAdd) {
      const field = form(channelAdd);
      if (field) execute(channelAdd, { channelAdd: field("channel") });
    } else if (channelDelete) execute(channelDelete, { channelDelete: channelDelete.dataset.channelDelete });
    else if (test) execute(test, { test: test.dataset.test });
    else if (del) execute(del, { delete: del.dataset.delete });
  });
});
