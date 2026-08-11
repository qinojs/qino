import { api, t } from "@qino/pub/qino.js";

cms.initNode("backend.superuser.stores.own", (el) => {
  const nid = Number(cms.el.nid(el));
  const node = api.cms.node(nid);

  el.querySelector("[data-create]").addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.target;
    const btn = form.querySelector("button");
    btn.disabled = true;
    const r = await node.api.post({
      name: form.elements.name.value,
      template: form.elements.template.value,
    }).catch((e) => ({ message: e?.message || String(e) }));
    btn.disabled = false;
    // The fresh list is the feedback; only a failure has something to say.
    if (!r?.ok) return (await import("@qino/u2/js/dialog/dialog.js")).alert(r?.message || await t`Action failed.`);
    cms.reloadNode(nid);
  });
});
