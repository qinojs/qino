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
  const values = (form) => Object.fromEntries([...form.elements].filter((e) => e.name && e.type !== "file")
    .map((e) => [e.name, e.type === "checkbox" ? e.checked : e.value.trim()]));

  el.addEventListener("change", (event) => {
    if (event.target.matches("[data-transport-type]")) transportFields();
  });
  el.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.target;
    const button = event.submitter;
    const data = values(form);
    if (button.matches("[data-settings-save]")) execute(button, { settings: data });
    else if (button.matches("[data-send]")) {
      button.disabled = true;
      try {
        const input = form.elements.attachments;
        data.attachments = await Promise.all([...input.files].map(async (file) => ({
          name: file.name,
          type: file.type,
          content: await dataUrl(file),
        })));
        await execute(button, { send: data });
      } catch (e) {
        await panel.alert(e?.message || String(e));
      } finally {
        button.disabled = false;
      }
    } else execute(button, { contactAdd: data });
  });
  el.addEventListener("click", async (event) => {
    const fetch = event.target.closest("[data-fetch]");
    const approve = event.target.closest("[data-approve]");
    const main = event.target.closest("[data-main]");
    const test = event.target.closest("[data-test]");
    const del = event.target.closest("[data-delete]");
    if (approve) {
      const [usr, ...rest] = approve.dataset.approve.split(":"); // the claimant, then the address
      execute(approve, { approve: { usr, address: rest.join(":") } });
    } else if (fetch) execute(fetch, { fetch: true });
    else if (main) execute(main, { main: main.dataset.main });
    else if (test) execute(test, { test: test.dataset.test });
    else if (del) execute(del, { delete: del.dataset.delete });
  });

  transportFields();
});

const dataUrl = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = () => reject(reader.error);
  reader.readAsDataURL(file);
});
