import { api, t } from "@qino/pub/qino.js";

const h = (name, attrs = {}, ...children) => {
  const el = document.createElement(name);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key === "class") el.className = value;
    else if (key in el) el[key] = value;
    else el.setAttribute(key, value === true ? "" : value);
  }
  el.append(...children.flat(Infinity).filter(value => value != null && value !== false));
  return el;
};

const TYPES = {
  text: "Text field",
  textarea: "Text block",
  select: "Dropdown",
  checkbox: "Checkbox",
  radio: "Radio buttons",
  email: "E-Mail",
  "email-reply-to": "E-Mail (sender)",
  number: "Number",
  url: "URL",
  date: "Date",
  time: "Time",
  "datetime-local": "Local date / time",
  month: "Month",
  week: "Week",
  range: "Range",
  tel: "Phone",
  color: "Color",
  flexible: "Mixed content",
};

const POSITIONS = { left: "Left", top: "Above", placeholder: "Inside the field", right: "Right" };

export const css = `
qino-cms .-fields1 { display:grid; gap:.75rem; }
qino-cms .-fields1 .-field { border:1px solid; padding:.5rem; }
qino-cms .-fields1 .-head { display:grid; grid-template-columns:1fr 1fr auto auto auto; gap:.4rem; }
qino-cms .-fields1 .-more { display:grid; gap:.4rem; margin-top:.5rem; }
qino-cms .-fields1 label { display:grid; gap:.2rem; }
qino-cms .-fields1 textarea { min-height:5rem; }
`;

const plain = value => String(value ?? "").replace(/<[^>]*>/g, "");
const valueOf = input => input.type === "checkbox" ? input.checked : input.value;
const at = (ref, path) => path.split(".").reduce((part, key) => part[key], ref.settings);
const save = (ref, path, input) => input.addEventListener("change", () => at(ref, path).put({ value: valueOf(input) }));
const text = async (ref, name, input) => {
  input.value = plain(await ref.text(name).get());
  input.addEventListener("change", () => ref.text(name).put({ value: input.value }));
};

export default async function (el, { node, signal }) {
  const ref = api.cms.node(node.id);
  const settings = await ref.settings.get({}, { signal }) ?? {};
  const inputs = settings.inputs ?? {};
  const sorted = String(settings.sort ?? "").split(",").filter(id => id in inputs);
  const ids = [...sorted, ...Object.keys(inputs).filter(id => !sorted.includes(id))];
  const position = h("select");
  for (const [value, label] of Object.entries(POSITIONS)) position.append(h("option", { value, selected: value === (settings.labelPosition || "left") }, label));
  save(ref, "labelPosition", position);

  const list = h("div", { class: "-fields" });
  const setOrder = async next => {
    await ref.settings.sort.put({ value: next.join(",") });
    el.reload();
  };
  const move = (from, to) => {
    const next = [...ids];
    const [id] = next.splice(from, 1);
    next.splice(to, 0, id);
    return setOrder(next);
  };

  for (const [index, id] of ids.entries()) {
    const input = inputs[id] ?? {};
    const type = h("select");
    for (const [value, label] of Object.entries(TYPES)) type.append(h("option", { value, selected: value === (input.type || "text") }, label));
    type.addEventListener("change", async () => {
      await ref.settings.inputs[id].type.put({ value: type.value });
      el.reload();
    }, { signal });

    const title = h("input", { placeholder: await t`Title` });
    const up = h("button", { type: "button", disabled: index === 0, title: await t`Move up` }, "↑");
    const down = h("button", { type: "button", disabled: index === ids.length - 1, title: await t`Move down` }, "↓");
    const remove = h("button", { type: "button", title: await t`Delete` }, "×");
    await text(ref, `${id}_title`, title);
    up.addEventListener("click", () => move(index, index - 1), { signal });
    down.addEventListener("click", () => move(index, index + 1), { signal });
    remove.addEventListener("click", async () => {
      await ref.settings.inputs[id].delete();
      el.reload();
    }, { signal });

    const required = h("input", { type: "checkbox", checked: !!input.required });
    const choices = h("textarea");
    const initial = h("input", { value: input.default ?? "" });
    const placeholder = h("input");
    const autocomplete = h("input", { value: input.autocomplete ?? "" });
    save(ref, `inputs.${id}.required`, required);
    save(ref, `inputs.${id}.default`, initial);
    save(ref, `inputs.${id}.autocomplete`, autocomplete);
    await Promise.all([
      text(ref, `${id}_options`, choices),
      text(ref, `${id}_placeholder`, placeholder),
    ]);

    const more = [
      h("label", {}, h("span", {}, await t`Required`), required),
      h("label", {}, h("span", {}, await t`Choices (one per line)`), choices),
      h("label", {}, h("span", {}, await t`Default value`), initial),
      h("label", {}, h("span", {}, await t`Placeholder`), placeholder),
      h("label", {}, h("span", {}, await t`Autocomplete`), autocomplete),
    ];
    if (type.value === "email-reply-to") {
      const recipient = h("input", { type: "checkbox", checked: !!input["is-recipient"] });
      save(ref, `inputs.${id}.is-recipient`, recipient);
      more.splice(1, 0, h("label", {}, h("span", {}, await t`Send a copy to this address`), recipient));
    }

    list.append(h("section", { class: "-field" },
      h("div", { class: "-head" }, type, title, up, down, remove),
      h("div", { class: "-more" }, more),
    ));
  }

  const add = h("button", { type: "button" }, await t`Add field`);
  add.addEventListener("click", async () => {
    await ref.settings.inputs[Date.now().toString(36)].put({ value: {} });
    el.reload();
  }, { signal });
  el.replaceChildren(h("div", { class: "-fields1" }, h("label", {}, await t`Label position`, position), list, add));
}
