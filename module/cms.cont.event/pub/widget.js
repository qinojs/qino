import { html } from "@qino/pub/html.js";
import { api } from "@qino/pub/api.js";
import { t as translate } from "@qino/pub/t.js";
import "@qino/u2/el/fields/fields.js";
import { confirm } from "@qino/u2/js/dialog/dialog.js";

import { bindSettings } from "../../cms/pub/js/settings.js";

const t = translate.in("cms.cont.event");

function shiftDate(value, days) {
  const date = new Date(value);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().split("T")[0];
}

export default async function (widget, { node, signal, cards = false, onChange = () => cms.reloadNode(node.id) }) {
  const ref = api.cms.node(node.id);
  const [settings, blocks] = await Promise.all([
    ref.settings.get({}, { signal }), ref.api.post({ blocks: true }, { signal }),
  ]);
  const prefix = `event-${node.id}`;
  const zone = settings.time_zone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  // all-day ends show the last included day, a moment no end; the row without a block adds one
  const row = (item = {}) => {
    const type = item.allDay ? "date" : "datetime-local";
    return html.async`<tr data-block="${item.id ?? ""}">
      <td><input type=checkbox name=allDay ${item.allDay ? html`checked` : ""} aria-label="${t`All day`}">
      <td><input name=start type="${type}" step=1 value="${item.localStart ?? ""}" required aria-label="${t`Start`}">
      <td><input name=end type="${type}" step=1 value="${item.allDay ? shiftDate(item.localEnd, -1) : item.localEnd === item.localStart ? "" : item.localEnd ?? ""}" aria-label="${t`End`}">
      <td>${item.id ? html.async`<button type=button class=u2-unstyle data-remove aria-label="${t`Delete block`}" title="${t`Delete block`}"><u2-ico icon=delete>✕</u2-ico></button>` : ""}
    </tr>`;
  };
  const field = (name, label, attributes = "") => html.async`<label for="${prefix}-${name}">${label}</label>
    <input id="${prefix}-${name}" setting="${name}" value="${settings[name] ?? ""}" ${attributes}>`;
  await widget.html`<div class="cms-event-editor ${cards ? "u2-flex" : ""}">
    <section class="${cards ? "u2-card" : ""}" style="flex:0 1 auto">
      <div class="${cards ? "-head" : ""}">${t`Dates`} (${blocks.length})</div>
      <div data-date-table style="padding:0;overflow:auto" tabindex=0 role=region aria-label="${t`Event blocks`}">
        <table class=u2-table style="padding:0;white-space:nowrap">
          <thead><tr>
            <th scope=col>${t`All day`}
            <th scope=col>${t`Start`}
            <th scope=col>${t`End`}
            <th scope=col aria-label="${t`Actions`}">
          <tbody>${blocks.map(row)}${row()}
        </table>
      </div>
      <div>
        <output role=status></output>
        <details><summary>${t`Advanced settings`}</summary>
          <u2-fields>
            <label for="${prefix}-zone">${t`Time zone`}</label>
            <select id="${prefix}-zone" name=timeZone>${[...new Set([zone, ...Intl.supportedValuesOf("timeZone")])].map((id) => html`<option ${id === zone ? html`selected` : ""}>${id}`)}</select>
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
      </u2-fields>
      <small id="${prefix}-price-hint">${t`Empty: unspecified. 0: free.`}</small>
    </section>
  </div>`;
  bindSettings(widget, ref);

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
  widget.on("change", "[data-block] input", (input) => {
    const tr = input.closest("tr"), [allDay, start, end] = tr.querySelectorAll("input");
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
    const item = blocks.find((block) => block.id === Number(tr.dataset.block));
    const local = { allDay: allDay.checked, localStart: start.value, localEnd: allDay.checked ? shiftDate(end.value || start.value, 1) : end.value || start.value };
    // an unchanged wall time keeps its exact instant: during a clock change it occurs twice
    const same = (key) => item?.allDay === local.allDay && Date.parse(item[key]) === Date.parse(local[key]);
    const save = {
      id: item?.id, timeZone: zone,
      start: same("localStart") ? item.start : local.localStart,
      end: same("localEnd") ? item.end : local.localEnd,
    };
    change(async () => {
      const saved = await ref.api.post({ save }, { signal });
      item ? Object.assign(item, local, saved) : await widget.reload();
    });
  });
  widget.on("click", "[data-remove]", async (button) => {
    if (!await confirm(await t`Delete this block?`)) return;
    change(async () => {
      await ref.api.post({ remove: Number(button.closest("tr").dataset.block) }, { signal });
      await widget.reload();
    });
  });
  // local times are shown in the zone, so they are read again
  widget.on("change", "[name=timeZone]", (select) => change(async () => {
    await ref.settings.time_zone.put({ value: select.value }, { signal });
    await widget.reload();
  }));
}
