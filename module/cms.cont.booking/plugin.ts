import { ApiError, html } from "@qino/qino";

import { book, bookings, cancel, slots } from "./mod.ts";
import api from "./nodeApi.ts";

import type { Ctx } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

export { default as dbSchema } from "./dbschema.json" with { type: "json" };
export { calendar } from "./calendar.ts";

const settingsSchema = { properties: {
  time_zone: { type: "string", default: "UTC", description: "IANA time zone for the displayed appointments, for example Europe/Zurich." },
  duration: { type: "integer", minimum: 0, default: 0, description: "Slot length in minutes. Zero books each offered event as a whole; a positive value splits availability windows." },
  horizon_days: { type: "integer", minimum: 1, default: 60, description: "How many days ahead visitors may book." },
} };

async function render(node: Node, { ctx, vars }: { ctx: Ctx; vars: Record<string, unknown> }) {
  const t = node.app.t.in("cms.cont.booking");
  const timeZone = String(node.settings.time_zone() ?? "UTC");
  const today = Temporal.Now.zonedDateTimeISO(timeZone).toPlainDate();
  const param = `cms_booking_${node.id}_date`;
  let date = today, error = "", success = "";
  try { if (ctx.req.query[param]) date = Temporal.PlainDate.from(ctx.req.query[param]); } catch { /* keep today */ }
  if (vars.book) {
    try {
      if (vars.your_name) throw new ApiError(400, "Booking could not be completed");
      const slot = JSON.parse(String(vars.slot ?? "null"));
      if (!slot || typeof slot.start !== "string") throw new ApiError(400, "Choose an appointment");
      await book(node, { eventId: Number(slot.eventId), start: slot.start, name: String(vars.name ?? ""), email: String(vars.email ?? ""), timeZone });
      success = await t`Your appointment is booked.`;
    } catch (e) {
      if (!(e instanceof ApiError) && !(e instanceof RangeError) && !(e instanceof SyntaxError)) throw e;
      error = e instanceof ApiError ? e.message : await t`Choose a valid appointment.`;
    }
  }
  if (vars.cancel) {
    await cancel(node, Number(vars.cancel));
    success = await t`Your appointment is cancelled.`;
  }
  const available = await slots(node, { start: date.toZonedDateTime(timeZone).toInstant().toString(), end: date.add({ days: 7 }).toZonedDateTime(timeZone).toInstant().toString(), timeZone });
  const mine = await bookings(node);
  const stamp = (value: string) => Temporal.Instant.from(value).toZonedDateTimeISO(timeZone).toLocaleString(ctx.lang, { dateStyle: "medium", timeStyle: "short" });
  const url = new URL(ctx.req.url.href);
  const dateId = `booking-${node.id}-date`, slotId = `booking-${node.id}-slot`;
  const nameId = `booking-${node.id}-name`, emailId = `booking-${node.id}-email`;
  return html.async`<div class=u2-width>
    ${node.cms.text(node, "title", { tag: "h2", initial: { en: "Book an appointment", de: "Termin buchen" } })}
    ${success ? html`<p role=status>${success}</p>` : ""}
    ${error ? html`<p role=alert>${error}</p>` : ""}
    <form method=get action="${url.pathname}" aria-label="${t`Choose a date`}">
      ${[...url.searchParams].filter(([key]) => key !== param).map(([key, value]) => html`<input type=hidden name="${key}" value="${value}">`)}
      <label for="${dateId}">${t`From date`}</label>
      <input id="${dateId}" type=date name="${param}" value="${date}" min="${today}" required>
      <button type=submit>${t`Show appointments`}</button>
    </form>
    <p>${t`Time zone`}: ${timeZone}</p>
    ${available.length ? html.async`<form method=post action="${url.href}" aria-label="${t`Book an appointment`}">
      ${node.cms.formFields(node)}
      <input type=text name=your_name autocomplete=off tabindex=-1 aria-hidden=true>
      <label for="${slotId}">${t`Appointment (required)`}</label>
      <select id="${slotId}" name=slot required><option value="">${t`Choose an appointment`}</option>
        ${available.map((slot) => html`<option value="${JSON.stringify({ eventId: slot.eventId, start: slot.start })}">${stamp(slot.start)} – ${stamp(slot.end)}</option>`)}
      </select>
      <label for="${nameId}">${t`Name (required)`}</label>
      <input id="${nameId}" name=name autocomplete=name maxlength=200 value="${vars.name ?? ""}" required>
      <label for="${emailId}">${t`Email (required)`}</label>
      <input id="${emailId}" type=email name=email autocomplete=email maxlength=254 value="${vars.email ?? ""}" required>
      <button type=submit name=book value=1>${t`Book appointment`}</button>
    </form>` : html.async`<p>${t`No appointments available in this period.`}</p>`}
    ${mine.length ? html.async`<section aria-label="${t`Bookings`}"><h3>${t`Bookings`}</h3><ul>${mine.map((row) => html.async`<li>
      <time datetime="${row.start}">${stamp(String(row.start))}</time> – ${stamp(String(row.end))}: ${row.name}
      <form method=post action="${url.href}" aria-label="${t`Cancel appointment`}">${node.cms.formFields(node)}
        <button type=submit name=cancel value="${row.id}">${t`Cancel appointment`}</button>
      </form>
    </li>`)}</ul></section>` : ""}
  </div>`;
}

export const cms = { node: { render, api, settingsSchema, widget: "pub/widget.js", css: ["pub/main.css"] } };
