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
    const frequencies = { "": t`Does not repeat`, DAILY: t`Daily`, WEEKLY: t`Weekly`, MONTHLY: t`Monthly`, YEARLY: t`Yearly`, custom: t`Custom` };
    const frequency = !item.rrule ? "" : /^FREQ=(DAILY|WEEKLY|MONTHLY|YEARLY)$/.exec(item.rrule)?.[1] || "custom";
    return html.async`<form data-offer="${item.id || ""}" aria-label="${item.id ? t`Edit appointment` : t`Add appointment`}">
      <fieldset><legend>${item.id ? t`Appointment` : t`New appointment`}</legend>
        <label for="${id}-start">${t`Start (required)`}</label>
        <input id="${id}-start" name=start type=datetime-local value="${item.localStart || ""}" required>
        <label for="${id}-end">${t`End (required)`}</label>
        <input id="${id}-end" name=end type=datetime-local value="${item.localEnd || ""}" required>
        <label for="${id}-zone">${t`Time zone`}</label>
        <input id="${id}-zone" name=timeZone value="${item.timeZone || settings.time_zone || "UTC"}" required>
        <label for="${id}-repeat">${t`Repeat`}</label>
        <select id="${id}-repeat" name=frequency data-repeat>${Object.entries(frequencies).map(([value, title]) => html.async`<option value="${value}"${value === frequency ? html.raw(" selected") : ""}>${title}</option>`)}</select>
        <details><summary>${t`Recurrence and exceptions`}</summary>
          <label for="${id}-rrule">${t`Recurrence rule (RRULE)`}</label>
          <input id="${id}-rrule" name=rrule value="${item.rrule || ""}" placeholder="FREQ=WEEKLY;BYDAY=MO" maxlength=2048>
          <label for="${id}-rdate">${t`Additional starts (ISO dates, one per line)`}</label>
          <textarea id="${id}-rdate" name=rdate>${(item.rdate || []).join("\n")}</textarea>
          <label for="${id}-exdate">${t`Excluded starts (ISO dates, one per line)`}</label>
          <textarea id="${id}-exdate" name=exdate>${(item.exdate || []).join("\n")}</textarea>
        </details>
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
    const dates = (value) => String(value).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    form.inert = true;
    await change({ save: { ...values, id: Number(form.dataset.offer) || undefined, rdate: dates(values.rdate), exdate: dates(values.exdate) } });
    form.inert = false;
  });
  widget.on("change", "[data-repeat]", (select) => {
    if (select.value !== "custom") select.form.elements.rrule.value = select.value ? `FREQ=${select.value}` : "";
  });
  widget.on("click", "[data-remove]", async (button) => {
    if (await confirm(await t`Delete this appointment?`)) await change({ remove: Number(button.dataset.remove) });
  });
  widget.on("click", "[data-cancel]", async (button) => {
    if (await confirm(await t`Cancel this appointment?`)) await change({ cancel: Number(button.dataset.cancel) });
  });
}
