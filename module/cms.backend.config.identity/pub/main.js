import { api, t } from "@qino/pub/qino.js";
import { alert } from "@qino/u2/js/dialog/dialog.js";

cms.initNode("backend.config.identity", (el) => {
  const nid = Number(cms.el.nid(el));
  const node = api.cms.node(nid);

  el.addEventListener("submit", async (event) => {
    const form = event.target.closest("[data-identity]");
    if (!form) return;
    event.preventDefault();
    try {
      await node.api.post({ save: Object.fromEntries(new FormData(form)) });
      const status = form.querySelector("[data-status]");
      status.textContent = await t`Saved`;
      setTimeout(() => status.textContent = "", 2000);
    } catch (e) {
      await alert(e.message);
    }
  });

  el.addEventListener("change", async (event) => {
    const input = event.target.closest("[data-asset] input[type=file]");
    const file = input?.files?.[0];
    if (!file) return;
    try {
      await node.api.post({ asset: { name: input.closest("[data-asset]").dataset.asset, dataUrl: await dataUrl(file) } });
      await cms.reloadNode(nid);
    } catch (e) {
      await alert(e.message);
    }
  });

  el.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-asset] [data-remove]");
    if (!button) return;
    try {
      await node.api.post({ removeAsset: button.closest("[data-asset]").dataset.asset });
      await cms.reloadNode(nid);
    } catch (e) {
      await alert(e.message);
    }
  });
});

const dataUrl = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = () => reject(reader.error);
  reader.readAsDataURL(file);
});
