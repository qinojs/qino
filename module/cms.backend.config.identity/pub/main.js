import { api } from "@qino/pub/api.js";
import { t } from "@qino/pub/t.js";
import { alert } from "@qino/u2/js/dialog/dialog.js";

cms.initNode("backend.config.identity", (el) => {
  const nid = Number(cms.el.nid(el));
  const node = api.cms.node(nid);
  const timers = new WeakMap();

  const save = async (input) => {
    if (!input.name || !input.checkValidity()) return;
    const status = input.closest(".u2-card").querySelector("[data-status]");
    status.textContent = "…";
    try {
      await node.api.post({ save: { [input.name]: input.value } });
      status.textContent = await t`Saved`;
    } catch (e) {
      status.textContent = "";
      await alert(e.message);
    }
  };

  el.addEventListener("input", (event) => {
    const input = event.target;
    if (!input.name || input.type === "file") return;
    clearTimeout(timers.get(input));
    timers.set(input, setTimeout(() => save(input), 500));
  });

  el.addEventListener("change", async (event) => {
    const input = event.target.closest("[data-asset] input[type=file]");
    if (!input) {
      clearTimeout(timers.get(event.target));
      await save(event.target);
      return;
    }
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
