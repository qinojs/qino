import { api } from "@qino/pub/api.js";

cms.initNode("cont.home.command", (el) => {
  const node = api.cms.node(Number(cms.el.nid(el)));
  const alert = async (message) => (await import("@qino/u2/js/dialog/dialog.js")).alert(message);

  // One call at a time; only failures are reported, the device's state shows the result.
  const send = async (button, vars) => {
    if (button.disabled) return;
    button.disabled = true;
    try {
      const response = await node.api.post({ run: true, ...vars });
      if (!response?.ok) await alert(response?.message || "Error");
    } catch (error) {
      await alert(error?.message || String(error));
    } finally { button.disabled = false; }
  };

  // Free input reads JSON where it parses (153, true), text otherwise.
  const read = (field) => {
    if (field.type === "range" || field.type === "number") return field.valueAsNumber;
    try { return JSON.parse(field.value); } catch { return field.value; }
  };

  el.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-run]");
    if (button) send(button, {});
  });
  el.addEventListener("input", (event) => {
    const output = event.target.form?.querySelector("output");
    if (output && event.target.type === "range") output.value = event.target.value;
  });
  el.addEventListener("submit", (event) => {
    const form = event.target.closest("form[data-run]");
    if (!form) return;
    event.preventDefault();
    send(event.submitter ?? form.querySelector("button"), { value: read(form.elements.value) });
  });
});
