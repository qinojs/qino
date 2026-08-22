import { nodePanel } from "@qino/m/cms.backend/pub/js/node.mjs";

cms.initNode("backend.superuser.messaging.email", (el) => {
  const panel = nodePanel(el, ["sending", "inbound", "send", "contacts", "journal"]);
  let saves = Promise.resolve();
  // re-rendered parts lose the shown/hidden state of the transport fields
  const transportFields = () => {
    const type = el.querySelector("[data-transport-type]")?.value;
    for (const fields of el.querySelectorAll("[data-transport-fields]")) {
      const hidden = fields.dataset.transportFields !== type;
      fields.hidden = hidden;
      fields.style.display = hidden ? "none" : "";
    }
  };
  const execute = async (button, data) => {
    await panel.execute(button, data);
    transportFields();
  };
  const save = async (form, data) => {
    const state = form.querySelector("[data-settings-state]");
    state.textContent = "…";
    const response = await panel.node.api.post({ settings: data })
      .catch((e) => ({ message: e?.message || String(e) }));
    state.textContent = response?.message || "✗";
  };
  const value = (input) => input.type === "checkbox" ? input.checked : input.value.trim();
  const values = (form) => Object.fromEntries([...form.elements].filter((e) => e.name && e.type !== "file")
    .map((e) => [e.name, value(e)]));

  el.addEventListener("change", (event) => {
    const form = event.target.closest("form[data-settings]");
    if (form) {
      const data = { [event.target.name]: value(event.target) };
      saves = saves.then(() => save(form, data));
    }
    if (event.target.matches("[data-transport-type]")) transportFields();
  });
  el.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.target;
    if (form.matches("[data-settings]")) return;
    const button = event.submitter;
    const data = values(form);
    if (button.matches("[data-send]")) {
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
    const inboundTest = event.target.closest("[data-inbound-test]");
    const approve = event.target.closest("[data-approve]");
    const main = event.target.closest("[data-main]");
    const test = event.target.closest("[data-test]");
    const del = event.target.closest("[data-delete]");
    await saves;
    if (approve) {
      const [usr, ...rest] = approve.dataset.approve.split(":"); // the claimant, then the address
      execute(approve, { approve: { usr, address: rest.join(":") } });
    } else if (fetch) execute(fetch, { fetch: true });
    else if (inboundTest) execute(inboundTest, { inboundTest: true });
    else if (main) execute(main, { main: main.dataset.main });
    else if (test) execute(test, { test: values(test.form).address });
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
