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
  const fields = (form) => Object.fromEntries([...form.elements].filter((e) => e.name).map((e) => [e.name, e.value.trim()]));

  el.addEventListener("change", (event) => {
    if (event.target.matches("[data-provider-type]")) providerFields();
  });
  el.addEventListener("submit", (event) => {
    event.preventDefault();
    const button = event.submitter;
    const values = fields(event.target);
    execute(button, button.matches("[data-provider-save]") ? { providerSave: values } : { send: values });
  });
  el.addEventListener("click", (event) => {
    const approve = event.target.closest("[data-approve]");
    const main = event.target.closest("[data-main]");
    const test = event.target.closest("[data-test]");
    const del = event.target.closest("[data-delete]");
    if (approve) {
      const [usr, ...rest] = approve.dataset.approve.split(":"); // the claimant, then the number
      execute(approve, { approve: { usr, number: rest.join(":") } });
    } else if (main) execute(main, { main: main.dataset.main });
    else if (test) execute(test, { test: test.dataset.test });
    else if (del) execute(del, { delete: del.dataset.delete });
  });

  providerFields();
});
