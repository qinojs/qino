import { api } from "../../core/pub/js/qino.js";

cms.initNode("backend.superuser.web_push", (el) => {
  const node = api.cms.node(Number(cms.el.nid(el)));
  let busy = false;

  const show = async (message) => (await import("@qino/u2/js/dialog/dialog.js")).alert(message);
  const refresh = () => Promise.all(["channels", "send", "subscriptions"].map(async (name) => {
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
