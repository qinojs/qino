import { nodePanel } from "@qino/m/cms.backend/pub/js/node.mjs";

cms.initNode("backend.superuser.messaging.webpush", (el) => {
  const { execute } = nodePanel(el, ["channels", "send", "subscriptions"]);

  el.addEventListener("submit", (event) => {
    event.preventDefault();
    const button = event.submitter;
    const field = (name) => event.target.elements[name].value.trim();
    button.matches("[data-send]")
      ? execute(button, { send: { to: field("to"), title: field("title"), body: field("body"), url: field("url") } })
      : execute(button, { channelAdd: field("channel") });
  });

  el.addEventListener("click", (event) => {
    const test = event.target.closest("[data-test]");
    const del = event.target.closest("[data-delete]");
    const channelDelete = event.target.closest("[data-channel-delete]");
    if (channelDelete) execute(channelDelete, { channelDelete: channelDelete.dataset.channelDelete });
    else if (test) execute(test, { test: test.dataset.test });
    else if (del) execute(del, { delete: del.dataset.delete });
  });
});
