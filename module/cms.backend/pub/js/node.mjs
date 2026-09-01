import { api } from "@qino/pub/api.js";

/**
 * The loop every backend panel runs: post to the node api, re-render the named cms-parts,
 * report the answer in a u2 dialog. One action at a time, the button disabled while it runs.
 */
export function nodePanel(el, parts = []) {
  const node = api.cms.node(Number(cms.el.nid(el)));
  let busy = false;

  const alert = async (message) => (await import("@qino/u2/js/dialog/dialog.js")).alert(message);
  const refresh = () => Promise.all(parts.map(async (name) => {
    el.querySelector(`[cms-part=${name}]`).innerHTML = await node.html.part(name).get();
  }));
  const execute = async (button, data) => {
    if (busy) return;
    busy = true;
    button.disabled = true;
    try {
      const response = await node.api.post(data);
      await refresh();
      await alert(response?.message || "");
    } catch (e) {
      await alert(e?.message || String(e));
    } finally {
      busy = false;
      button.disabled = false;
    }
  };
  return { node, execute, refresh, alert };
}
