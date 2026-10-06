// Action forms: data fields built from the picked action's `input` schema, read back typed.

const renderer = () => import("@qino/item-cdn/tools/schema/render/html.js").then((mod) => mod.toInput);

/** How a field is rendered and read back. Anything without a plain type is edited as JSON. */
const kind = (schema) => schema.type === "boolean" ? "boolean"
  : schema.enum || schema.type === "string" ? "string"
  : schema.type === "number" || schema.type === "integer" ? "number" : "json";

const text = (value) => value === undefined ? undefined : typeof value === "string" ? value : JSON.stringify(value);

/** The field's schema as `toInput` renders it: booleans and optional choices may stay unset. */
function control(schema, type, required, attrs) {
  const html = { ...schema["x-html"], ...attrs, "data-type": type };
  if (type === "boolean") {
    return { ...schema, type: ["string", "null"], enum: ["true", "false"], default: text(schema.default), "x-html": html };
  }
  if (type === "json") {
    const examples = schema.examples?.map(text);
    return { ...schema, type: "string", "x-multiline": true, default: text(schema.default), examples, "x-html": html };
  }
  if (schema.enum && !required) return { ...schema, type: [schema.type ?? "string", "null"], "x-html": html };
  return { ...schema, "x-html": html };
}

/** Show the picked action: its description, its possible targets and its data fields, filled from `values`. */
export async function describe(form, values) {
  const input = form.elements.action;
  const option = [...input.list.options].find((option) => option.value === input.value);
  const schema = JSON.parse(option?.dataset.input || "{}"), targets = JSON.parse(option?.dataset.targets || "null");
  form.querySelector("[data-action-info]").textContent = option?.dataset.description ?? "";
  form.querySelector("[data-targets]").hidden = !targets?.length;
  for (const entity of form.elements.entities.options) {
    entity.hidden = !targets?.includes(entity.value);
    if (entity.hidden) entity.selected = false;
  }
  const body = form.querySelector("[data-fields]"), free = form.elements.data, toInput = await renderer();
  // Without a schema the data is one free-form JSON object.
  free.disabled = free.closest("tr").hidden = !!schema.properties;
  if (!schema.properties && values) free.value = JSON.stringify(values, null, 2);
  // Field keys are the likely parameters: where a command's run-time value goes.
  const keys = Object.keys(schema.properties ?? {});
  form.querySelector("[data-parameters]").replaceChildren(...keys.map((key) => new Option(key)));
  for (const row of body.querySelectorAll("[data-field]")) row.remove();
  for (const [key, field] of Object.entries(schema.properties ?? {})) {
    const id = `${input.id}-${key}`, type = kind(field), required = !!schema.required?.includes(key);
    const row = body.insertRow(), label = document.createElement("label");
    row.dataset.field = "";
    label.htmlFor = id;
    label.textContent = (field.title ?? key) + (required ? " *" : "");
    row.insertCell().append(label);
    row.insertCell().innerHTML = toInput(control(field, type, required, { id }), {
      name: "data." + key, required, value: type === "number" || type === "string" ? values?.[key] : text(values?.[key]),
    });
  }
}

/** A field's typed value. `auto` (free input) reads JSON where it parses: 153, true, {"a":1}; text otherwise. */
export function read(field) {
  const { type } = field.dataset, value = field.value;
  if (type === "number") return Number(value);
  if (type === "boolean") return value === "true";
  if (type === "json") {
    try { return JSON.parse(value); } catch { throw new Error(`${field.name.slice(5)}: invalid JSON`); }
  }
  if (type === "auto") { try { return JSON.parse(value); } catch { return value; } }
  return value;
}

/** The form's data; empty fields are left out. */
export function dataOf(form) {
  const free = form.elements.data;
  const data = free && !free.disabled ? JSON.parse(free.value || "{}") : {};
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Action data must be a JSON object");
  for (const field of form.querySelectorAll("[data-type]")) {
    if (field.value !== "") data[field.name.slice(5)] = read(field);
  }
  return data;
}

/** Load a stored command into its provider's form: run it with changes, or save it again. */
export async function fill(form, command) {
  form.dataset.command = command.id;
  form.elements.action.value = command.action;
  form.elements.name.value = command.name;
  form.elements.parameter.value = command.parameter;
  await describe(form, command.data);
  for (const option of form.elements.entities.options) option.selected = command.targets.includes(option.value);
}
