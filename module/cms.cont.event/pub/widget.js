import { html } from "@qino/pub/html.js";
import { api } from "@qino/pub/api.js";
import { t as translate } from "@qino/pub/t.js";
import { confirm } from "@qino/u2/js/dialog/dialog.js";

const t = translate.in("cms.cont.event");

export default async function (widget, { node, signal }) {
  const ref = api.cms.node(node.id);
  const [settings, blocks] = await Promise.all([
    ref.settings.get({}, { signal }), ref.api.post({ blocks: true }, { signal }),
  ]);
  const prefix = `event-${node.id}`;
  const block = (item = {}) => {
    const id = `${prefix}-${item.id || "new"}`, type = item.allDay ? "date" : "datetime-local";
    return html.async`<form data-block="${item.id || ""}" aria-label="${item.id ? t`Edit block` : t`Add block`}">
      <fieldset><legend>${item.id ? t`Event block` : t`New block`}</legend>
        <label><input type=checkbox name=allDay ${item.allDay ? "checked" : ""}> ${t`All day`}</label>
        <label for="${id}-start">${t`Start (required)`}</label>
        <input id="${id}-start" name=start type="${type}" step=1 value="${item.localStart || ""}" required>
        <label for="${id}-end">${t`End (exclusive, required)`}</label>
        <input id="${id}-end" name=end type="${type}" step=1 value="${item.localEnd || ""}" required aria-describedby="${prefix}-hint">
        <input type=hidden name=timeZone value="${item.timeZone || settings.time_zone || "UTC"}">
        <button type=submit>${t`Save block`}</button>
        ${item.id ? html.async`<button type=button data-remove="${item.id}">${t`Delete block`}</button>` : ""}
      </fieldset>
    </form>`;
  };
  await widget.html`<div>
    <form data-zone aria-label="${t`Time zone`}">
      <label for="${prefix}-zone">${t`Time zone`}</label>
      <input id="${prefix}-zone" name=timeZone value="${settings.time_zone || "UTC"}" required>
      <button type=submit>${t`Save time zone`}</button>
    </form>
    <details><summary>${t`Event details`}</summary>
    <form data-details aria-label="${t`Event details`}">
      <fieldset><legend>${t`Event details`}</legend>
        <label for="${prefix}-street">${t`Street address`}</label>
        <input id="${prefix}-street" name=address_street value="${settings.address_street || ""}">
        <label for="${prefix}-postal">${t`Postal code`}</label>
        <input id="${prefix}-postal" name=address_postal_code value="${settings.address_postal_code || ""}">
        <label for="${prefix}-locality">${t`City / locality`}</label>
        <input id="${prefix}-locality" name=address_locality value="${settings.address_locality || ""}">
        <label for="${prefix}-country">${t`Country code (ISO 3166-1)`}</label>
        <input id="${prefix}-country" name=address_country pattern="[A-Za-z]{2}" maxlength=2 value="${settings.address_country || ""}">
        <label for="${prefix}-price">${t`Price (empty: unspecified, 0: free)`}</label>
        <input id="${prefix}-price" name=price type=number min=0 step=any value="${settings.price ?? ""}">
        <label for="${prefix}-currency">${t`Currency (ISO 4217)`}</label>
        <input id="${prefix}-currency" name=currency pattern="[A-Za-z]{3}" maxlength=3 value="${settings.currency || ""}">
        <label for="${prefix}-performer">${t`Instructors / performers`}</label>
        <input id="${prefix}-performer" name=performer value="${settings.performer || ""}">
        <label for="${prefix}-language">${t`Event language (BCP 47)`}</label>
        <input id="${prefix}-language" name=language value="${settings.language || ""}">
        <label for="${prefix}-external">${t`External event page`}</label>
        <input id="${prefix}-external" name=external_link type=url value="${settings.external_link || ""}">
        <button type=submit>${t`Save event details`}</button>
      </fieldset>
    </form>
    </details>
    <p id="${prefix}-hint">${t`All-day blocks end on the first day not included.`}</p>
    <p role=status></p>
    ${blocks.map(block)}${block()}
  </div>`;
  const initial = new WeakMap();
  for (const form of widget.querySelectorAll("form[data-block]")) initial.set(form, Object.fromEntries(new FormData(form)));
  const status = widget.querySelector("[role=status]");
  const change = async (form, action) => {
    form.inert = true;
    try { await action(); widget.reload(); await cms.reloadNode(node.id); }
    catch (error) { status.textContent = error?.message || String(error); }
    finally { form.inert = false; }
  };
  widget.on("submit", "form[data-details]", (form, event) => {
    event.preventDefault();
    const details = Object.fromEntries(new FormData(form));
    details.price = details.price === "" ? null : Number(details.price);
    return change(form, () => ref.api.post({ details }, { signal }));
  });
  widget.on("submit", "form[data-zone]", (form, event) => {
    event.preventDefault();
    const value = new FormData(form).get("timeZone");
    try { new Intl.DateTimeFormat(undefined, { timeZone: value }); }
    catch (error) { status.textContent = error.message; return; }
    return change(form, () => ref.settings.time_zone.put({ value }, { signal }));
  });
  widget.on("change", "[name=allDay]", (input) => {
    for (const field of input.form.querySelectorAll("[name=start], [name=end]")) {
      const value = field.value;
      field.type = input.checked ? "date" : "datetime-local";
      field.value = input.checked ? value.split("T")[0] : value && `${value}T00:00`;
    }
  });
  widget.on("submit", "form[data-block]", (form, event) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(form));
    const original = blocks.find((item) => item.id === Number(form.dataset.block));
    if (original && Boolean(values.allDay) === original.allDay) {
      for (const key of ["start", "end"]) if (values[key] === initial.get(form)[key]) values[key] = original[key];
    }
    return change(form, () => ref.api.post({ save: { start: values.start, end: values.end, timeZone: values.timeZone, id: Number(form.dataset.block) || undefined } }, { signal }));
  });
  widget.on("click", "[data-remove]", async (button) => {
    if (await confirm(await t`Delete this block?`)) await change(button.form, () => ref.api.post({ remove: Number(button.dataset.remove) }, { signal }));
  });
}
