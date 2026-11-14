import { html } from "@qino/pub/html.js";
import { api } from "@qino/pub/api.js";
import { t as translate } from "@qino/pub/t.js";
import { confirm } from "@qino/u2/js/dialog/dialog.js";

import { bindSettings } from "../../cms/pub/js/settings.js";

const t = translate.in("cms.cont.booking");

export default async function (widget, { node, signal }) {
  const ref = api.cms.node(node.id);
  const [settings, offers, bookings] = await Promise.all([
    ref.settings.get({}, { signal }), ref.api.post({ offers: true }, { signal }), ref.api.post({ bookings: true }, { signal }),
  ]);
  const prefix = `booking-${node.id}`;
  const offer = (item = {}) => {
    const id = `${prefix}-${item.id || "new"}`;
    return html.async`<form data-offer="${item.id || ""}" aria-label="${item.id ? t`Edit appointment` : t`Add appointment`}">
      <fieldset><legend>${item.id ? t`Appointment` : t`New appointment`}</legend>
        <label for="${id}-start">${t`Start (required)`}</label>
        <input id="${id}-start" name=start type=datetime-local step=1 value="${item.localStart || ""}" required>
        <label for="${id}-end">${t`End (required)`}</label>
        <input id="${id}-end" name=end type=datetime-local step=1 value="${item.localEnd || ""}" required>
        <label for="${id}-zone">${t`Time zone`}</label>
        <input id="${id}-zone" name=timeZone value="${item.timeZone || settings.time_zone || "UTC"}" required>
        <button type=submit>${t`Save appointment`}</button>
        ${item.id ? html.async`<button type=button data-remove="${item.id}">${t`Delete appointment`}</button>` : ""}
      </fieldset>
    </form>`;
  };
  await widget.html`<div>
    <label for="${prefix}-zone">${t`Display time zone`}</label>
    <input id="${prefix}-zone" setting=time_zone value="${settings.time_zone || "UTC"}">
    <label for="${prefix}-duration">${t`Slot duration in minutes (0: whole appointment)`}</label>
    <input id="${prefix}-duration" setting=duration type=number min=0 value="${settings.duration ?? 0}">
    <label for="${prefix}-horizon">${t`Bookable days ahead`}</label>
    <input id="${prefix}-horizon" setting=horizon_days type=number min=1 value="${settings.horizon_days ?? 60}">
    <p role=status></p>
    ${offers.map(offer)}${offer()}
    <details><summary>${t`Bookings`} (${bookings.length})</summary>
      <ul>${bookings.map((booking) => html.async`<li>${booking.start} – ${booking.end}<br>${booking.name} · ${booking.email}
        <button type=button data-cancel="${booking.id}">${t`Cancel appointment`}</button>
      </li>`)}</ul>
    </details>
  </div>`;
  bindSettings(widget, ref);
  const initial = new WeakMap();
  for (const form of widget.querySelectorAll("form[data-offer]")) initial.set(form, Object.fromEntries(new FormData(form)));
  const status = widget.querySelector("[role=status]");
  const change = async (input) => {
    try {
      await ref.api.post(input, { signal });
      widget.reload();
      await cms.reloadNode(node.id);
    } catch (error) { status.textContent = error?.message || String(error); }
  };
  widget.on("submit", "form[data-offer]", async (form, event) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(form));
    const original = offers.find((item) => item.id === Number(form.dataset.offer));
    // Preserve the original instant when an unchanged wall time occurs twice during a clock change.
    if (original && values.timeZone === initial.get(form).timeZone) {
      for (const key of ["start", "end"]) if (values[key] === initial.get(form)[key]) values[key] = original[key];
    }
    form.inert = true;
    await change({ save: { ...values, id: Number(form.dataset.offer) || undefined } });
    form.inert = false;
  });
  widget.on("click", "[data-remove]", async (button) => {
    if (await confirm(await t`Delete this appointment?`)) await change({ remove: Number(button.dataset.remove) });
  });
  widget.on("click", "[data-cancel]", async (button) => {
    if (await confirm(await t`Cancel this appointment?`)) await change({ cancel: Number(button.dataset.cancel) });
  });
}
