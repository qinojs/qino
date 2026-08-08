import { api } from "../../core/pub/js/qino.js";

cms.initNode("backend.superuser.sms", (el) => {
  const node = api.cms.node(Number(cms.el.nid(el)));
  let busy = false;

  const show = async (message) => (await import("@qino/u2/js/dialog/dialog.js")).alert(message);
  const providerFields = () => {
    const type = el.querySelector("[data-provider-type]")?.value;
    for (const fields of el.querySelectorAll("[data-provider-fields]")) fields.hidden = fields.dataset.providerFields !== type;
  };
  const refresh = async () => {
    await Promise.all(["provider", "send", "phones"].map(async (name) => {
      el.querySelector(`[cms-part=${name}]`).innerHTML = await node.html.part(name).get();
    }));
    providerFields();
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
  const fields = (button) => {
    const form = button.closest("form");
    return form.reportValidity() ? Object.fromEntries([...form.elements].filter((e) => e.name).map((e) => [e.name, e.value.trim()])) : null;
  };

  el.addEventListener("change", (event) => {
    if (event.target.matches("[data-provider-type]")) providerFields();
  });
  el.addEventListener("click", (event) => {
    const providerSave = event.target.closest("[data-provider-save]");
    const send = event.target.closest("[data-send]");
    const approve = event.target.closest("[data-approve]");
    const main = event.target.closest("[data-main]");
    const test = event.target.closest("[data-test]");
    const del = event.target.closest("[data-delete]");
    if (providerSave) {
      const values = fields(providerSave);
      if (values) execute(providerSave, { providerSave: values });
    } else if (send) {
      const values = fields(send);
      if (values) execute(send, { send: values });
    } else if (approve) execute(approve, { approve: approve.dataset.approve });
    else if (main) execute(main, { main: main.dataset.main });
    else if (test) execute(test, { test: test.dataset.test });
    else if (del) execute(del, { delete: del.dataset.delete });
  });

  providerFields();
});
