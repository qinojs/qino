import { api } from "@qino/pub/api.js";
import { t } from "@qino/pub/t.js";

/** Wait for the restart: requests fail until the new process is up, so a failure means "not yet". */
async function untilBack(tries = 60) {
  while (tries--) {
    await new Promise((r) => setTimeout(r, 1000));
    if (await fetch("", { method: "HEAD", cache: "no-store" }).then((r) => r.ok, () => false)) return true;
  }
  return false;
}

cms.initNode("backend.superuser.git", (el) => {
  const nid = Number(cms.el.nid(el));
  const node = api.cms.node(nid);

  el.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-act]");
    if (!btn) return;
    const { alert, confirm, prompt } = await import("@qino/u2/js/dialog/dialog.js");
    if (btn.dataset.confirm && !await confirm(btn.dataset.confirm)) return;
    const message = btn.dataset.act === "commit" ? await prompt(await t`Commit message`, "") : "";
    if (btn.dataset.act === "commit" && !message?.trim()) return;
    const card = btn.closest("[data-repo]");
    btn.disabled = true;
    const r = await node.api.post({
      act: btn.dataset.act,
      repo: card?.dataset.repo ?? "", // the server card belongs to no repository
      message: btn.dataset.act === "switch" ? card?.querySelector("[name=ref]")?.value ?? "" : message,
    }).catch((e) => ({ message: e?.message || String(e) }));
    btn.disabled = false;
    // git says something worth reading either way — the output is the whole feedback.
    await alert(r?.message || await t`Done.`);
    if (!r?.ok) return;
    if (r.restarting) {
      if (await untilBack()) location.reload();
      else await alert(await t`The server did not come back.`);
      return;
    }
    cms.reloadNode(nid);
  });
});
