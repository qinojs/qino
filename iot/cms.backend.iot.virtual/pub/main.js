import { nodePanel } from "@qino/m/cms.backend/pub/js/node.mjs";

cms.initNode("backend.home.virtual", (el) => {
  const { execute, alert } = nodePanel(el, ["list"]);

  el.addEventListener("click", (event) => {
    const create = event.target.closest("[data-new-provider]");
    if (create) execute(create, { provider: "new" });
    const remove = event.target.closest("[data-remove]");
    if (remove) execute(remove, { remove: Number(remove.dataset.remove) });
  });

  el.addEventListener("submit", async (event) => {
    const form = event.target.closest("form[data-apply], form[data-virtual]");
    if (!form) return;
    event.preventDefault();
    const button = form.querySelector("button[type=submit]");
    const { elements } = form;
    if (form.hasAttribute("data-apply")) {
      const apply = { template: elements.template.value, source: Number(elements.source.value),
        device: elements.device.value, provider: Number(elements.provider.value) };
      return execute(button, { apply });
    }
    let value;
    try { value = JSON.parse(elements.value.value || "{}"); } catch { return alert("Value schema: invalid JSON"); }
    await execute(button, { virtual: {
      provider: Number(elements.provider.value), name: elements.name.value, value,
      source_provider: Number(elements.source_provider.value), source_entity: elements.source_entity.value.trim(),
      command: Number(elements.command.value),
    } });
  });
});
