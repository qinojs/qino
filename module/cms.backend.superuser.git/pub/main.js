import { api, t } from "@qino/pub/qino.js";

cms.initNode("backend.superuser.git", (el) => {
  const nid = Number(cms.el.nid(el));
  const node = api.cms.node(nid);

  el.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-act]");
    if (!btn) return;
    const { alert, confirm } = await import("@qino/u2/js/dialog/dialog.js");
    if (btn.dataset.confirm && !await confirm(btn.dataset.confirm)) return;
    const card = btn.closest("[data-repo]");
    btn.disabled = true;
    const r = await node.api.post({
      act: btn.dataset.act,
      repo: card.dataset.repo,
      message: card.querySelector("[name=message]")?.value ?? "",
    }).catch((e) => ({ message: e?.message || String(e) }));
    btn.disabled = false;
    // git says something worth reading either way — the output is the whole feedback.
    await alert(r?.message || await t`Done.`);
    if (r?.ok) cms.reloadNode(nid);
  });
});
