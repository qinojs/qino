import { nodePanel } from "@qino/m/cms.backend/pub/js/node.mjs";

cms.initNode("backend.superuser.messaging.email", (el) => {
  const panel = nodePanel(el, ["sending", "inbound", "send", "contacts", "journal"]);
  // re-rendered parts lose the shown/hidden state of the transport fields
  const transportFields = () => {
    const type = el.querySelector("[data-transport-type]")?.value;
    for (const fields of el.querySelectorAll("[data-transport-fields]")) fields.hidden = fields.dataset.transportFields !== type;
  };
  const execute = async (button, data) => {
    await panel.execute(button, data);
    transportFields();
  };
  // the button's own form as {name: value}, validated — null when invalid
  const values = (button) => {
    const form = button.closest("form");
    if (!form.reportValidity()) return null;
    return Object.fromEntries([...form.elements].filter((e) => e.name)
      .map((e) => [e.name, e.type === "checkbox" ? e.checked : e.value.trim()]));
  };

  el.addEventListener("change", (event) => {
    if (event.target.matches("[data-transport-type]")) transportFields();
  });
  el.addEventListener("click", (event) => {
    const save = event.target.closest("[data-settings-save]");
    const fetch = event.target.closest("[data-fetch]");
    const send = event.target.closest("[data-send]");
    const add = event.target.closest("[data-contact-add]");
    const approve = event.target.closest("[data-approve]");
    const main = event.target.closest("[data-main]");
    const test = event.target.closest("[data-test]");
    const del = event.target.closest("[data-delete]");
    if (save) {
      const settings = values(save);
      if (settings) execute(save, { settings });
    } else if (send) {
      const message = values(send);
      if (message) execute(send, { send: message });
    } else if (add) {
      const contact = values(add);
      if (contact) execute(add, { contactAdd: contact });
    } else if (approve) {
      const [usr, ...rest] = approve.dataset.approve.split(":"); // the claimant, then the address
      execute(approve, { approve: { usr, address: rest.join(":") } });
    } else if (fetch) execute(fetch, { fetch: true });
    else if (main) execute(main, { main: main.dataset.main });
    else if (test) execute(test, { test: test.dataset.test });
    else if (del) execute(del, { delete: del.dataset.delete });
  });

  transportFields();
});
