import { nodePanel } from "@qino/m/cms.backend/pub/js/node.mjs";
import { t } from "@qino/pub/t.js";
import { dataOf, describe, fill, read } from "./action.js";

cms.initNode("backend.home", (el) => {
  // The current view is the page's one cms-part.
  const { execute, refresh, alert } = nodePanel(el, [el.querySelector("[cms-part]").getAttribute("cms-part")]);
  // Actions change nothing on the page: the form keeps its input for the next call.
  const call = nodePanel(el, []).execute;

  // A template's content in a dialog inside the panel, so the handlers below serve it too.
  const open = async (template, init) => {
    const { modal } = await import("@qino/u2/js/dialog/dialog.js");
    await modal({
      body: "",
      root: el,
      buttons: [{ title: await t`Close`, value: null }],
      init: (dialog) => {
        dialog.querySelector("form").prepend(template.content.cloneNode(true));
        init?.(dialog);
      },
    });
  };

  el.addEventListener("click", (event) => {
    if (event.target.closest("[data-refresh]")) refresh().catch((error) => alert(error?.message || String(error)));
    const button = event.target.closest("[data-dialog]");
    if (button) open(button.nextElementSibling);
    const point = event.target.closest("[data-add-point]");
    // One creation form, prefilled from the entity row.
    if (point) open(el.querySelector("[data-new-point]"), (dialog) => {
      if (!point.dataset.addPoint) return;
      const form = dialog.querySelector("form[data-datapoint]"), values = JSON.parse(point.dataset.addPoint);
      for (const name of ["provider", "entity", "name", "unit", "type"]) form.elements[name].value = values[name];
      form.querySelector("[data-mapping]").hidden = values.type !== "state";
    });
    const run = event.target.closest("[data-run]");
    if (run) call(run, { run: Number(run.dataset.run) });
    const edit = event.target.closest("[data-edit]");
    if (edit) {
      const command = JSON.parse(edit.dataset.edit);
      const form = el.querySelector(`form[data-home-action][data-provider="${command.provider}"]`);
      fill(form, command).then(() => form.elements.action.focus());
    }
    const remove = event.target.closest("[data-remove-command]");
    if (remove) discard(remove);
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
    const action = event.target.closest("form[data-home-action] input[name=action]");
    if (action) describe(action.form).catch((error) => alert(error?.message || String(error)));
  });

  // A new action form: no stored command, no fields of a previous action.
  el.addEventListener("reset", (event) => {
    const form = event.target.closest("form[data-home-action]");
    if (!form) return;
    delete form.dataset.command;
    setTimeout(() => describe(form)); // after the browser has reset the inputs
  });

  const discard = async (button) => {
    const { confirm } = await import("@qino/u2/js/dialog/dialog.js");
    if (!await confirm(await t`Delete this command?`)) return;
    await execute(button, { removeCommand: Number(button.dataset.removeCommand) });
  };

  // The api input of a form; throws on invalid input. `save` stores an action form as command.
  const input = (form, save) => {
    if (form.hasAttribute("data-measurement")) {
      const value = form.elements.value.valueAsNumber;
      const time = form.elements.time.value ? new Date(form.elements.time.value).getTime() : Date.now();
      if (!Number.isFinite(value) || !Number.isFinite(time)) throw new Error("Enter a valid value and time");
      return { measurement: { id: Number(form.dataset.id), value, time } };
    }
    if (form.hasAttribute("data-provider-config")) {
      const provider = {
        name: form.elements.name.value, adapter: form.dataset.adapter, enabled: form.elements.enabled.checked,
        config: Object.create(null),
      };
      if (form.dataset.provider) provider.id = Number(form.dataset.provider);
      for (const field of form.elements) {
        if (!field.name.startsWith("config.") || field.disabled) continue;
        const path = field.name.slice(7).split(".");
        let target = provider.config;
        for (const key of path.slice(0, -1)) target = target[key] ??= Object.create(null);
        target[path.at(-1)] = field.type === "checkbox" ? field.checked : field.type === "number" ? field.valueAsNumber : field.value;
      }
      return { config: provider };
    }
    if (form.hasAttribute("data-datapoint")) {
      const { name, interval, record } = form.elements;
      const meta = { name: name.value, interval: interval.valueAsNumber, record: record.checked };
      // Source and interpretation of an existing datapoint are immutable.
      if (form.dataset.id) return { datapoint: { id: Number(form.dataset.id), ...meta } };
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
      return { datapoint: {
        provider: Number(form.elements.provider.value), entity: form.elements.entity.value || crypto.randomUUID(),
        unit: form.elements.unit.value, type, mapping: type === "state" ? mapping : {}, ...meta,
      } };
    }
    const targets = [...form.elements.entities.selectedOptions].map((option) => option.value);
    const request = { provider: Number(form.dataset.provider), action: form.elements.action.value, data: dataOf(form) };
    if (!save) return { ...request, entities: targets.length ? targets : undefined };
    const name = form.elements.name.value.trim();
    if (!name || !request.action) throw new Error("A command needs a name and an action");
    const id = form.dataset.command ? { id: Number(form.dataset.command) } : {};
    return { command: { ...request, name, targets, parameter: form.elements.parameter.value.trim(), ...id } };
  };

  el.addEventListener("submit", async (event) => {
    const form = event.target.closest(
      "form[data-provider-config], form[data-datapoint], form[data-home-action], form[data-measurement], form[data-run-command]",
    );
    if (!form) return;
    event.preventDefault();
    if (form.hasAttribute("data-run-command")) {
      return call(event.submitter, { run: Number(form.dataset.id), value: read(form.elements.value) });
    }
    const save = event.submitter?.value === "save";
    let data;
    try { data = input(form, save); } catch (error) { return await alert(error?.message || String(error)); }
    // Calling an action changes nothing on the page; saving a command lists it.
    const send = form.hasAttribute("data-home-action") && !save ? call : execute;
    await send(event.submitter ?? form.querySelector("button[type=submit]"), data);
    form.closest("dialog")?.close();
  });
});
