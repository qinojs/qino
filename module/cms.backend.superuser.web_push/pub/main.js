import { apt } from "../../core/pub/js/qino.js";

cms.initNode("backend.superuser.web_push", (el) => {
  const node = apt.cms.node(Number(cms.el.nid(el)));
  let busy = false;

  const show = async (message) => (await import("@qino/u2/js/dialog/dialog.js")).alert(message);
  const refresh = async () => {
    for (const name of ["channels", "send", "subscriptions"]) {
      el.querySelector(`[cms-part=${name}]`).innerHTML = await node.html.part(name).get();
    }
  };
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
  const field = (button, name) => button.closest("form").elements[name].value.trim();
  const valid = (button) => button.closest("form").reportValidity();

  el.addEventListener("click", (event) => {
    const send = event.target.closest("[data-send]");
    const test = event.target.closest("[data-test]");
    const del = event.target.closest("[data-delete]");
    const channelAdd = event.target.closest("[data-channel-add]");
    const channelDelete = event.target.closest("[data-channel-delete]");
    if (send) {
      if (!valid(send)) return;
      execute(send, { send: { to: field(send, "to"), title: field(send, "title"), body: field(send, "body"), url: field(send, "url") } });
    } else if (channelAdd) {
      if (!valid(channelAdd)) return;
      execute(channelAdd, { channelAdd: field(channelAdd, "channel") });
    } else if (channelDelete) execute(channelDelete, { channelDelete: channelDelete.dataset.channelDelete });
    else if (test) execute(test, { test: test.dataset.test });
    else if (del) execute(del, { delete: del.dataset.delete });
  });
});
