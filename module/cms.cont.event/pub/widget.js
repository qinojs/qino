import { html } from "@qino/pub/html.js";
import { api } from "@qino/pub/api.js";
import { t as translate } from "@qino/pub/t.js";
import { confirm } from "@qino/u2/js/dialog/dialog.js";

const t = translate.in("cms.cont.event");

export default async function (widget, { node, signal, content, expanded = false, onChange = () => cms.reloadNode(node.id) }) {
  const ref = api.cms.node(node.id);
  const [settings, blocks] = await Promise.all([
    ref.settings.get({}, { signal }), ref.api.post({ blocks: true }, { signal }),
  ]);
  const prefix = `event-${node.id}`;
  const zone = settings.time_zone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const status = () => html`<output data-save-state role=status></output>`;
  const row = (item) => {
    const id = `${prefix}-${item.id}`;
    return html.async`<tr>
      <td><input form="${id}" type=checkbox name=allDay ${item.allDay ? html`checked` : ""} aria-labelledby="${prefix}-day-head"></td>
      <td><input form="${id}" name=start type="${item.allDay ? "date" : "datetime-local"}" step=1 value="${item.localStart}" required aria-labelledby="${prefix}-start-head"></td>
      <td><input form="${id}" name=end type="${item.allDay ? "date" : "datetime-local"}" step=1 value="${item.localEnd}" required aria-labelledby="${prefix}-end-head" aria-describedby="${prefix}-hint"></td>
      <td><form id="${id}" data-block="${item.id}" aria-label="${t`Edit block`}">
        <input type=hidden name=timeZone value="${item.timeZone}">
        <button type=button class=u2-unstyle data-remove="${item.id}" aria-label="${t`Delete block`}" title="${t`Delete block`}"><u2-ico icon=delete>✕</u2-ico></button>
      </form></td>
    </tr>`;
  };
  const field = (name, label, attributes = {}) => html.async`<label for="${prefix}-${name}">${label}
    <input id="${prefix}-${name}" name="${name}" value="${settings[name] ?? ""}" ${html.join(Object.entries(attributes).map(([name, value]) => html`${html.raw(name)}="${value}"`), " ")}>
  </label>`;
  const info = html.async`<details class="${content ? "u2-card" : ""}" data-event-info ${expanded ? html`open` : ""}>
    <summary class="${content ? "-head" : ""}">${t`Event details`}</summary>
    <form data-details aria-label="${t`Event details`}" class=u2-grid style="grid-template-columns:minmax(0,1fr)">
      <fieldset><legend>${t`Venue address`}</legend><div class=u2-grid style="--u2-Items-width:12rem">
        ${field("address_street", t`Street address`)}
        ${field("address_postal_code", t`Postal code`)}
        ${field("address_locality", t`City / locality`)}
        ${field("address_country", t`Country code`, { pattern: "[A-Za-z]{2}", maxlength: 2 })}
      </div></fieldset>
      <fieldset><legend>${t`Price`}</legend><div class=u2-grid style="--u2-Items-width:10rem">
        ${field("price", t`Price`, { type: "number", min: 0, step: "any", "aria-describedby": `${prefix}-price-hint` })}
        ${field("currency", t`Currency`, { pattern: "[A-Za-z]{3}", maxlength: 3 })}
      </div><small id="${prefix}-price-hint">${t`Empty: unspecified. 0: free.`}</small></fieldset>
      <fieldset><legend>${t`Organisation`}</legend><div class=u2-grid style="--u2-Items-width:12rem">
        ${field("performer", t`Instructors / performers`)}
        ${field("language", t`Event language`)}
      </div>${field("external_link", t`External event page`, { type: "url" })}</fieldset>
      ${status()}
    </form>
  </details>`;
  const dates = html.async`<section class="${content ? "u2-card" : ""}" data-event-dates>
    <h3 class="${content ? "-head" : ""}">${t`Dates`} (<span data-block-count>${blocks.length}</span>)</h3>
    <div class=u2-grid style="grid-template-columns:minmax(0,1fr)">
      <p data-no-dates ${blocks.length ? html`hidden` : ""}>${t`No date yet`}</p>
      <div data-date-table style="overflow:auto" tabindex=0 role=region aria-label="${t`Event blocks`}" ${!blocks.length ? html`hidden` : ""}>
        <table class="u2-table -NoSideGaps" style="padding:0;white-space:nowrap"><thead><tr>
          <th id="${prefix}-day-head" scope=col>${t`All day`}</th>
          <th id="${prefix}-start-head" scope=col>${t`Start`}</th>
          <th id="${prefix}-end-head" scope=col>${t`End`}</th>
          <th scope=col aria-label="${t`Actions`}"></th>
        </tr></thead><tbody>${blocks.map(row)}</tbody></table>
      </div>
      <small id="${prefix}-hint">${t`For all-day dates, the end is the first day not included.`}</small>
      <output data-date-state role=status></output>
      <details data-add-block><summary>${t`Add date`}</summary>
        <form data-block="" aria-label="${t`Add block`}" class=u2-grid style="grid-template-columns:minmax(0,1fr)">
          <label class="u2-flex -check"><input type=checkbox name=allDay> ${t`All day`}</label>
          <div class=u2-grid style="--u2-Items-width:16rem">
            <label for="${prefix}-new-start">${t`Start`}<input id="${prefix}-new-start" name=start type=datetime-local step=1 required></label>
            <label for="${prefix}-new-end">${t`End`}<input id="${prefix}-new-end" name=end type=datetime-local step=1 required aria-describedby="${prefix}-hint"></label>
          </div>
          <input type=hidden name=timeZone value="${zone}">
          ${status()}
        </form>
      </details>
      <details><summary>${t`Advanced settings`}</summary>
        <form data-zone aria-label="${t`Time zone`}">
          <label for="${prefix}-zone">${t`Time zone`}<input id="${prefix}-zone" name=timeZone value="${zone}" required></label>
          ${status()}
        </form>
      </details>
    </div>
  </section>`;
  await widget.html`<div class=cms-event-editor><div class="${content ? "u2-grid -event-columns" : "u2-flex -Col"}">
    ${content ? html.async`<div data-event-main class=u2-grid style="grid-template-columns:minmax(0,1fr);align-content:start">${info}</div>` : ""}
    ${dates}${!content ? info : ""}
  </div></div>`;
  if (content) widget.querySelector("[data-event-main]").prepend(content);

  const states = new WeakMap(), timers = new Map();
  let queue = Promise.resolve();
  const values = (form) => Object.fromEntries(new FormData(form));
  const remember = (form) => states.set(form, { saved: JSON.stringify(values(form)), initial: values(form), version: 0 });
  for (const form of widget.querySelectorAll("form[data-block], form[data-details], form[data-zone]")) remember(form);
  const show = async (form, message) => {
    const output = form.querySelector("[data-save-state]") || widget.querySelector("[data-date-state]");
    if (output) output.textContent = await message;
  };
  const counts = () => {
    widget.querySelector("[data-block-count]").textContent = blocks.length;
    widget.querySelector("[data-date-table]").hidden = !blocks.length;
    widget.querySelector("[data-no-dates]").hidden = !!blocks.length;
  };
  const save = (form) => {
    clearTimeout(timers.get(form));
    queue = queue.then(async () => {
      if (signal?.aborted || !form.isConnected) return;
      const state = states.get(form), data = values(form), snapshot = JSON.stringify(data), version = state.version;
      if (snapshot === state.saved || !form.checkValidity()) return;
      const fresh = form.matches("[data-block]") && !form.dataset.block;
      try {
        await show(form, t`Saving…`);
        if (form.matches("[data-details]")) {
          data.price = data.price === "" ? null : Number(data.price);
          await ref.api.post({ details: data }, { signal });
        } else if (form.matches("[data-zone]")) {
          new Intl.DateTimeFormat(undefined, { timeZone: data.timeZone });
          await ref.settings.time_zone.put({ value: data.timeZone }, { signal });
          const updated = await ref.api.post({ blocks: true }, { signal });
          for (const item of updated) {
            const target = widget.querySelector(`form[data-block="${item.id}"]`);
            if (!target || JSON.stringify(values(target)) !== states.get(target).saved) continue;
            for (const field of target.elements) if (field.name === "start" || field.name === "end") field.value = item[field.name === "start" ? "localStart" : "localEnd"];
            target.elements.timeZone.value = data.timeZone;
            Object.assign(blocks.find((block) => block.id === item.id), item);
            remember(target);
          }
          widget.querySelector('form[data-block=""]').elements.timeZone.value = data.timeZone;
        } else {
          if (data.start >= data.end) { await show(form, t`End must follow start.`); return; }
          const original = blocks.find((item) => item.id === Number(form.dataset.block));
          const range = { start: data.start, end: data.end, timeZone: data.timeZone, id: Number(form.dataset.block) || undefined };
          if (original && Boolean(data.allDay) === original.allDay) {
            for (const key of ["start", "end"]) if (data[key] === state.initial[key]) range[key] = original[key];
          }
          if (fresh) form.inert = true;
          const result = await ref.api.post({ save: range }, { signal });
          const item = { ...result, allDay: Boolean(data.allDay), localStart: data.start, localEnd: data.end, timeZone: data.timeZone };
          if (fresh) {
            blocks.push(item);
            widget.querySelector("tbody").insertAdjacentHTML("beforeend", String(await row(item)));
            remember(widget.querySelector(`form[data-block="${item.id}"]`));
            for (const field of form.elements) if (field.name === "start" || field.name === "end") field.value = "";
            counts();
            state.saved = JSON.stringify(values(form));
          } else Object.assign(original, item);
        }
        if (!fresh) { state.saved = snapshot; state.initial = JSON.parse(snapshot); }
        await show(form, state.version === version ? t`Saved` : t`Unsaved changes`);
        await onChange();
      } catch (error) { if (error?.name !== "AbortError") await show(form, error?.message || String(error)); }
      finally { if (fresh) form.inert = false; }
    });
    return queue;
  };
  const schedule = (input, delay) => {
    const form = input.form;
    if (!form || !states.has(form)) return;
    if (form.matches("[data-details]")) form.elements.currency.required = form.elements.price.value !== "";
    const state = states.get(form);
    state.version++;
    show(form, t`Unsaved changes`);
    clearTimeout(timers.get(form));
    timers.set(form, setTimeout(() => save(form), delay));
  };
  widget.on("input", "[name]", (input, event) => { if (!event.isComposing) schedule(input, 500); });
  widget.on("change", "[name]", (input) => {
    if (input.name === "allDay") {
      const fields = [...input.form.elements].filter((field) => field.name === "start" || field.name === "end");
      for (const field of fields) {
        const value = field.value;
        field.type = input.checked ? "date" : "datetime-local";
        field.value = input.checked ? value.split("T")[0] : value && `${value}T00:00`;
      }
      // Date inputs use UTC day coordinates.
      if (input.checked && fields[1].valueAsNumber <= fields[0].valueAsNumber) fields[1].valueAsNumber = fields[0].valueAsNumber + 86_400_000;
    }
    schedule(input, 0);
  });
  widget.on("submit", "form[data-block], form[data-details], form[data-zone]", (form, event) => { event.preventDefault(); save(form); });
  widget.on("click", "[data-remove]", async (button) => {
    if (!await confirm(await t`Delete this block?`)) return;
    const form = button.form;
    clearTimeout(timers.get(form));
    queue = queue.then(async () => {
      try {
        await ref.api.post({ remove: Number(button.dataset.remove) }, { signal });
        blocks.splice(blocks.findIndex((item) => item.id === Number(button.dataset.remove)), 1);
        button.closest("tr").remove();
        counts();
        await onChange();
      } catch (error) { await show(form, error?.message || String(error)); }
    });
  });
  return () => { for (const timer of timers.values()) clearTimeout(timer); };
}
