import { nodePanel } from "@qino/m/cms.backend/pub/js/node.mjs";

cms.initNode("backend.home", (el) => {
  const { execute, refresh, alert } = nodePanel(el, ["settings", "list"]);

  el.addEventListener("click", (event) => {
    if (event.target.closest("[data-refresh]")) refresh().catch((e) => alert(e?.message || String(e)));
  });

  el.addEventListener("change", (event) => {
    const select = event.target.closest("select[name=action]");
    if (!select) return;
    const fields = JSON.parse(select.selectedOptions[0]?.dataset.fields || "{}");
    select.form.querySelector("[data-action-fields]").textContent = JSON.stringify(fields, null, 2);
  });

  el.addEventListener("submit", async (event) => {
    const form = event.target.closest("form[data-config], form[data-home-action]");
    if (!form) return;
    event.preventDefault();
    const button = form.querySelector("button[type=submit]");
    try {
      if (form.dataset.module) {
        const values = Object.fromEntries([...form.elements].filter((input) => input.name && !input.disabled).map((input) => [
          input.name, input.type === "checkbox" ? input.checked : input.type === "number" ? input.valueAsNumber : input.value,
        ]));
        return await execute(button, { config: { module: form.dataset.module, values } });
      }
      const data = JSON.parse(form.elements.data.value || "{}");
      if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Action data must be a JSON object");
      const targets = [...form.elements.entities.selectedOptions].map((option) => option.value);
      await execute(button, {
        provider: form.dataset.provider, action: form.elements.action.value,
        entities: targets.length ? targets : undefined, data,
      });
    } catch (e) {
      await alert(e?.message || String(e));
    }
  });
});
