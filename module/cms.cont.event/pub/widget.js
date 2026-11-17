import { html } from "@qino/pub/html.js";
import { api } from "@qino/pub/api.js";
import { t as translate } from "@qino/pub/t.js";
import "@qino/u2/el/fields/fields.js";
import { confirm } from "@qino/u2/js/dialog/dialog.js";

const t = translate.in("cms.cont.event");

function shiftDate(value, days) {
  const date = new Date(value);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().split("T")[0];
}

/** An event's dates and details. `post` is its api, by default the node's own (the backend passes its own). */
export default async function (widget, {
  node, signal, cards = false, onChange = () => cms.reloadNode(node.id),
  post = (input) => api.cms.node(node.id).api.post(input, { signal }),
}) {
  const { event, timeZone: zone, dates } = await post({ get: true });
  const prefix = `event-${node.id}`;
  // all-day ends show the last included day, a moment no end; the row without a date adds one
  const row = (item = {}) => {
    const type = item.allDay ? "date" : "datetime-local";
    return html.async`<tr data-date="${item.id}">
      <td><input type=checkbox name=allDay ${item.allDay ? html`checked` : ""} aria-label="${t`All day`}">
      <td><input name=start type="${type}" step=1 value="${item.localStart}" required aria-label="${t`Start`}">
      <td><input name=end type="${type}" step=1 value="${item.allDay ? shiftDate(item.localEnd, -1) : item.localEnd === item.localStart ? "" : item.localEnd}" aria-label="${t`End`}">
      <td><input name=name value="${item.name}" size=12 aria-label="${t`Name`}">
      <td><input name=price type=number min=0 step=any size=6 value="${item.price}" aria-label="${t`Own price`}">
      <td>${item.id ? html.async`<button type=button class=u2-unstyle data-remove aria-label="${t`Delete date`}" title="${t`Delete date`}"><u2-ico icon=delete>✕</u2-ico></button>` : ""}
    </tr>`;
  };
  const field = (name, label, attributes = "") => html.async`<label for="${prefix}-${name}">${label}</label>
    <input id="${prefix}-${name}" name="${name}" data-event-field value="${event[name]}" ${attributes}>`;
  await widget.html`<div class="cms-event-editor ${cards ? "u2-flex" : ""}">
    <section class="${cards ? "u2-card" : ""}" style="flex:0 1 auto">
      <div class="${cards ? "-head" : ""}">${t`Dates`} (${dates.length})</div>
      <div style="padding:0;overflow:auto" tabindex=0 role=region aria-label="${t`Dates`}">
        <table class=u2-table style="padding:0;white-space:nowrap">
          <thead><tr>
            <th scope=col>${t`All day`}
            <th scope=col>${t`Start`}
            <th scope=col>${t`End`}
            <th scope=col>${t`Name`}
            <th scope=col>${t`Own price`}
            <th scope=col aria-label="${t`Actions`}">
          <tbody>${dates.map(row)}${row()}
        </table>
      </div>
      <div>
        <output role=status></output>
        <details><summary>${t`Advanced settings`}</summary>
          <u2-fields>
            <label for="${prefix}-zone">${t`Time zone`}</label>
            <select id="${prefix}-zone" name=time_zone data-event-field>
              <option value="">${t`Site default`}${event.time_zone ? "" : ` (${zone})`}
              ${Intl.supportedValuesOf("timeZone").map((id) => html`<option ${id === event.time_zone ? html`selected` : ""}>${id}`)}
            </select>
          </u2-fields>
        </details>
      </div>
    </section>
    <section class="${cards ? "u2-card" : ""}" style="flex:0 1 auto">
      <div class="${cards ? "-head" : ""}">${t`Event details`}</div>
      <u2-fields>
        ${field("address_street", t`Street address`)}
        ${field("address_postal_code", t`Postal code`, html`size=8`)}
        ${field("address_locality", t`City / locality`)}
        ${field("address_country", t`Country code`, html`maxlength=2 size=3`)}
        ${field("price", t`Price`, html`type=number min=0 step=any size=8 aria-describedby="${prefix}-price-hint"`)}
        ${field("currency", t`Currency`, html`maxlength=3 size=4`)}
        ${field("performer", t`Instructors / performers`)}
        ${field("language", t`Event language`)}
        ${field("external_link", t`External event page`, html`type=url`)}
        ${field("online_url", t`Take part online`, html`type=url`)}
        <label for="${prefix}-status">${t`Status`}</label>
        <select id="${prefix}-status" name=status data-event-field>
          ${[["", t`As planned`], ["cancelled", t`Cancelled`], ["postponed", t`Postponed`], ["rescheduled", t`Rescheduled`]]
            .map(([value, label]) => html.async`<option value="${value}" ${event.status === value ? html`selected` : ""}>${label}`)}
        </select>
      </u2-fields>
      <small id="${prefix}-price-hint">${t`Empty: unspecified. 0: free.`}</small>
    </section>
  </div>`;
  const status = widget.querySelector("[role=status]");
  let queue = Promise.resolve();
  // one change after the other, so a slow answer never overtakes a later one
  const change = (action) => queue = queue.then(async () => {
    try {
      await action();
      status.textContent = await t`Saved`;
      await onChange();
    } catch (error) { if (error?.name !== "AbortError") status.textContent = error?.message || String(error); }
  });
  widget.on("change", "[data-date] input", (input) => {
    const tr = input.closest("tr"), [allDay, start, end, name, price] = tr.querySelectorAll("input");
    if (input === allDay) {
      for (const field of [start, end]) {
        const value = field.value, last = field === end;
        field.type = allDay.checked ? "date" : "datetime-local";
        field.value = allDay.checked ? value.split("T")[0] : value && `${last ? shiftDate(value, 1) : value}T00:00`;
        if (allDay.checked && last && /T00:00(?::00)?$/.test(value)) field.value = shiftDate(field.value, -1);
      }
      if (allDay.checked && end.value < start.value) end.value = start.value;
    }
    end.min = start.value;
    if (!start.checkValidity() || !end.checkValidity()) return;
    // no end: the day itself, or the moment it starts
    const item = dates.find((date) => date.id === Number(tr.dataset.date));
    const local = { allDay: allDay.checked, localStart: start.value, localEnd: allDay.checked ? shiftDate(end.value || start.value, 1) : end.value || start.value };
    // an unchanged wall time keeps its exact instant: during a clock change it occurs twice
    const same = (key) => item?.allDay === local.allDay && Date.parse(item[key]) === Date.parse(local[key]);
    const save = {
      id: item?.id, name: name.value, price: price.value === "" ? null : Number(price.value),
      start: same("localStart") ? item.start : local.localStart,
      end: same("localEnd") ? item.end : local.localEnd,
    };
    change(async () => {
      const saved = await post({ save });
      item ? Object.assign(item, local, saved) : await widget.reload();
    });
  });
  widget.on("click", "[data-remove]", async (button) => {
    if (!await confirm(await t`Delete this date?`)) return;
    change(async () => {
      await post({ remove: Number(button.closest("tr").dataset.date) });
      await widget.reload();
    });
  });
  // details save as they are left; the server checks them. Local times are shown in the zone: read again
  widget.on("change", "[data-event-field]", (field) => change(async () => {
    const value = field.name === "price" ? (field.value === "" ? null : Number(field.value)) : field.value;
    await post({ set: { [field.name]: value } });
    if (field.name === "time_zone") await widget.reload();
  }));
}
