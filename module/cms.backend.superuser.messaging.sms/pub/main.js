import { nodePanel } from "@qino/m/cms.backend/pub/js/node.mjs";

cms.initNode("backend.superuser.messaging.sms", (el) => {
  const panel = nodePanel(el, ["provider", "send", "phones"]);
  // re-rendered parts lose the shown/hidden state of the provider fields
  const providerFields = () => {
    const type = el.querySelector("[data-provider-type]")?.value;
    for (const fields of el.querySelectorAll("[data-provider-fields]")) fields.hidden = fields.dataset.providerFields !== type;
  };
  const execute = async (button, data) => {
    await panel.execute(button, data);
    providerFields();
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
