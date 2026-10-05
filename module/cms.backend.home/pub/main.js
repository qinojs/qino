import { nodePanel } from "@qino/m/cms.backend/pub/js/node.mjs";

cms.initNode("backend.home", (el) => {
  const { execute, refresh, alert } = nodePanel(el, ["settings", "list", "measurements"]);

  el.addEventListener("click", (event) => {
    if (event.target.closest("[data-refresh]")) refresh().catch((error) => alert(error?.message || String(error)));
    const point = event.target.closest("[data-add-point]");
    if (point) {
      // One shared creation form, prefilled from the entity row.
      const details = el.querySelector("[data-new-point]"), { elements } = details.querySelector("form");
      const values = JSON.parse(point.dataset.addPoint);
      for (const name of ["provider", "entity", "name", "unit", "type"]) elements[name].value = values[name];
      elements.type.dispatchEvent(new Event("change", { bubbles: true }));
      details.open = true;
      details.scrollIntoView({ block: "nearest" });
      elements.name.focus();
    }
    const add = event.target.closest("[data-add-map]");
    if (add) {
      const fieldset = add.closest("[data-mapping]");
      fieldset.querySelector("tbody").append(fieldset.querySelector("template").content.cloneNode(true));
    }
  });

  el.addEventListener("change", (event) => {
    const record = event.target.closest("[data-record]");
    if (record) return execute(record, { datapoint: { id: Number(record.dataset.id), record: record.checked } });
    const enabled = event.target.closest("[data-provider-enabled]");
    if (enabled) return execute(enabled, { provider: Number(enabled.dataset.provider), enabled: enabled.checked });
    const type = event.target.closest("form[data-datapoint] select[name=type]");
    if (type) type.form.querySelector("[data-mapping]").hidden = type.value !== "state";
    const select = event.target.closest("select[name=action]");
    if (!select) return;
    const fields = JSON.parse(select.selectedOptions[0]?.dataset.fields || "{}");
    select.form.querySelector("[data-action-fields]").textContent = JSON.stringify(fields, null, 2);
  });

  el.addEventListener("submit", async (event) => {
    const form = event.target.closest("form[data-provider-config], form[data-datapoint], form[data-home-action], form[data-measurement]");
    if (!form) return;
    event.preventDefault();
    const button = form.querySelector("button[type=submit]");
    try {
      if (form.hasAttribute("data-measurement")) {
        const value = form.elements.value.valueAsNumber;
        const time = form.elements.time.value ? new Date(form.elements.time.value).getTime() : Date.now();
        if (!Number.isFinite(value) || !Number.isFinite(time)) throw new Error("Enter a valid value and time");
        return await execute(button, { measurement: { id: Number(form.dataset.id), value, time } });
      }
      if (form.hasAttribute("data-provider-config")) {
        const input = {
          name: form.elements.name.value, adapter: form.dataset.adapter, enabled: form.elements.enabled.checked,
          config: Object.create(null),
        };
        if (form.dataset.provider) input.id = Number(form.dataset.provider);
        for (const field of form.elements) {
          if (!field.name.startsWith("config.") || field.disabled) continue;
          const path = field.name.slice(7).split(".");
          let target = input.config;
          for (const key of path.slice(0, -1)) target = target[key] ??= Object.create(null);
          target[path.at(-1)] = field.type === "checkbox" ? field.checked : field.type === "number" ? field.valueAsNumber : field.value;
        }
        return await execute(button, { config: input });
      }
      if (form.hasAttribute("data-datapoint")) {
        const { name, interval, record } = form.elements;
        const meta = { name: name.value, interval: interval.valueAsNumber, record: record.checked };
        // Source and interpretation of an existing datapoint are immutable.
        if (form.dataset.id) return await execute(button, { datapoint: { id: Number(form.dataset.id), ...meta } });
        const mapping = Object.create(null);
        for (const row of form.querySelectorAll("[data-mapping] tbody tr")) {
          const key = row.querySelector("[data-state]").value;
          if (!key) continue;
          if (Object.hasOwn(mapping, key)) throw new Error("Each state must have a unique code mapping");
          const code = row.querySelector("[data-code]").valueAsNumber;
          if (!Number.isInteger(code)) throw new Error("State codes must be integers");
          mapping[key] = code;
        }
        const type = form.elements.type.value;
        return await execute(button, { datapoint: {
          provider: Number(form.elements.provider.value), entity: form.elements.entity.value || crypto.randomUUID(),
          unit: form.elements.unit.value, type, mapping: type === "state" ? mapping : {}, ...meta,
        } });
      }
      const data = JSON.parse(form.elements.data.value || "{}");
      if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Action data must be a JSON object");
      const targets = [...form.elements.entities.selectedOptions].map((option) => option.value);
      await execute(button, {
        provider: Number(form.dataset.provider), action: form.elements.action.value,
        entities: targets.length ? targets : undefined, data,
      });
    } catch (error) { await alert(error?.message || String(error)); }
  });
});
