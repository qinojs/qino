import { AccessError, ApiError, html, sql, tableRef } from "@qino/qino";
import { renderAccess } from "@qino/qino/cms.backend";
import { get, list, zoneOf } from "@qino/qino/cms.event";
import { formatDates } from "@qino/qino/cms.cont.event";
import * as u2 from "@qino/qino/u2";

import type { Ctx } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

export default async function (panel: Node, id: number, categories: { node: Node; title: string; write: boolean }[], ctx: Ctx) {
  const event = await panel.cms.node(id), access = await event.access();
  const row = event.exists() && await get(event);
  if (!row) throw new ApiError(404, "Event not found");
  // whatever module shows it; it moves between categories only from one
  const parent = await event.parent(), movable = parent?.vs.module === "cms.cont.event.category";
  if (access < 2 && !await event.isReadable()) throw new AccessError();
  const write = await panel.access() >= 2 && access >= 2;
  const t = panel.app.t.in("cms.backend.event");
  const url = ctx.req.url.toURL(), back = new URL(url);
  back.searchParams.delete("id");
  back.searchParams.delete("content_lang");
  const langs = panel.app.languages.all, lang = langs.includes(ctx.lang) ? ctx.lang : panel.app.languages.def;
  const texts = await event.texts();
  const ids = [Number(event.vs.title_id ?? 0), ...["location", "main"].flatMap((name) => texts.has(name) ? [texts.get(name)!.id] : [])];
  // one query primes the text cache for every language
  const rows = await event.db.query`SELECT text_id, lang, text FROM ${sql.id(tableRef("text_lang"))}
    WHERE ${sql.in("text_id", ids)} AND ${sql.in("lang", langs)}`;
  for (const id of ids) for (const lang of langs) event.app.dbTexts.text(id).lang(lang).value = "";
  for (const row of rows) event.app.dbTexts.text(Number(row.text_id)).lang(String(row.lang)).value = String(row.text ?? "");
  const text = async (name: string, lang: string) => texts.has(name) ? String(await event.showText(name, lang)) : "";
  const names = new Intl.DisplayNames(ctx.lang, { type: "language" });
  const dates = write ? [] : await list(event);
  u2.assets(ctx, ["el/rte/rte.css", "el/fields/fields.css", "el/fields/fields.js"]);
  return html.async`<div class="u2-flex cms-event-detail" style="align-items:flex-start" data-event-detail="${event.id}">
    <section class=u2-card data-event-content style="flex:0 1 auto">
      <div class=-head><a href="${back.href}">${t`Events`}</a> › <span data-event-title data-lang="${lang}">${event.showTitle(lang)}</span></div>
      <div><a href="${event.url()}" target=_blank>${t`Open page`}</a></div>
      ${langs.map((lang) => html`<form id="event-${id}-${lang}" data-event-texts hidden>
        <input type=hidden name=id value="${id}"><input type=hidden name=lang value="${lang}">
      </form>`)}
      ${write && movable ? html`<form id="event-${id}-category" data-event-move hidden><input type=hidden name=event value="${id}"></form>` : ""}
      <div style="padding:0;overflow:auto" tabindex=0 role=region aria-label="${t`Content`}">
        <table class=u2-table data-event-translations style="padding:0">
          <thead><tr>
            <th scope=col>${t`Content`}</th>
            ${langs.map((lang) => html`<th scope=col lang="${ctx.lang}">${names.of(lang) || lang}</th>`)}
          </tr></thead>
          <tbody>
            <tr>
              <th scope=row>${t`Title`}</th>
              ${langs.map(async (lang) => html.async`<td><input name=title lang="${lang}" form="event-${id}-${lang}" value="${await event.title(lang)}" size=28 required aria-label="${t`Title`}" ${!write ? html`disabled` : ""}></td>`)}
            </tr>
            <tr>
              <th scope=row>${t`Location`}</th>
              ${langs.map(async (lang) => html.async`<td><input name=location lang="${lang}" form="event-${id}-${lang}" value="${await text("location", lang)}" size=28 aria-label="${t`Location`}" ${!write ? html`disabled` : ""}></td>`)}
            </tr>
            <tr>
              <th scope=row>${t`Description`}</th>
              ${langs.map(async (lang) => html.async`<td><u2-rte name=main lang="${lang}"><textarea name=main form="event-${id}-${lang}" rows=6 cols=28 aria-label="${t`Description`}" ${!write ? html`readonly` : ""}>${await text("main", lang)}</textarea></u2-rte>${write ? html`<output data-save-state role=status form="event-${id}-${lang}"></output>` : ""}</td>`)}
            </tr>
            <tr>
              <th scope=row><label for="event-${id}-category-select">${t`Category`}</label></th>
              <td colspan="${langs.length}">${!movable ? parent?.showTitle() ?? "" : write ? html`<select id="event-${id}-category-select" name=category form="event-${id}-category" required>${categories.filter((category) => category.write).map((category) => html`<option value="${category.node.id}" ${category.node.id === Number(event.vs.basis) ? html`selected` : ""}>${category.title}</option>`)}</select><output data-save-state role=status form="event-${id}-category"></output>`
                : categories.find((category) => category.node.id === Number(event.vs.basis))?.title || t`Unassigned`}</td>
            </tr>

          </tbody>
        </table>
      </div>
    </section>
    ${renderAccess(event, write)}
    ${write ? html`<div data-event-widget="${id}" data-widget-src="${panel.app.modules.get("cms.cont.event")!.modUrl}pub/widget.js"></div>` : html.async`<section class=u2-card style="flex:0 1 auto">
      <div class=-head>${t`Dates`}</div>
      ${dates.length ? html`<ul>${formatDates(dates, ctx.lang, await zoneOf(panel.app, row)).map((date) => html`<li>${date}</li>`)}</ul>` : html.async`<p>${t`No date yet`}</p>`}
    </section>`}
  </div>`;
}
