import { AccessError, ApiError, html } from "@qino/qino";
import { list } from "@qino/qino/cms.event";
import { formatDates } from "@qino/qino/cms.cont.event";
import * as u2 from "@qino/qino/u2";

import type { Ctx } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

export default async function (panel: Node, id: number, categories: { node: Node; title: string; write: boolean }[], ctx: Ctx) {
  const event = await panel.cms.node(id), access = await event.access();
  if (!event.exists() || event.vs.module !== "cms.cont.event") throw new ApiError(404, "Event not found");
  if (access < 2 && !await event.isReadable()) throw new AccessError();
  const write = await panel.access() >= 2 && access >= 2;
  const t = panel.app.t.in("cms.backend.event");
  const url = ctx.req.url.toURL(), back = new URL(url);
  back.searchParams.delete("event");
  back.searchParams.delete("content_lang");
  const asked = url.searchParams.get("content_lang") || ctx.lang;
  const lang = panel.app.languages.all.includes(asked) ? asked : panel.app.languages.def;
  const texts = await event.texts();
  const text = async (name: string) => texts.has(name) ? String(await event.showText(name, lang)) : "";
  const title = String(await event.title(lang));
  const current = categories.find((category) => category.node.id === Number(event.vs.basis));
  const blocks = write ? [] : await list(event);
  u2.assets(ctx, ["el/rte/rte.css"]);
  return html.async`<div class=cms-event-detail data-event-detail="${event.id}">
    <nav class=u2-flex aria-label="${t`Event management`}"><a href="${back.href}">${t`Back to events`}</a> <a href="${event.url()}">${t`Open page`}</a></nav>
    <h2 data-event-title>${event.showTitle(lang)}</h2>
    <div class=u2-flex style="align-items:center">
      <span data-event-access="${id}">${event.vs.access === null ? t`Inherited` : Number(event.vs.access) === 0 ? t`Private` : t`Explicit access`}</span>
      ${write && access >= 3 ? html.async`<button class=u2-unstyle type=button data-event-visibility="${id}" data-inherit="${event.vs.access === null ? "false" : "true"}">${event.vs.access === null ? t`Make private` : t`Inherit category access`}</button>` : ""}
      ${current ? html`<span data-event-category="${id}">${current.title}</span>` : ""}
    </div>
    ${panel.app.languages.all.length > 1 ? html.async`<form method=get action="${url.pathname}">
      ${[...url.searchParams].filter(([key]) => key !== "content_lang").map(([key, value]) => html`<input type=hidden name="${key}" value="${value}">`)}
      <label>${t`Content language`}<select name=content_lang>${panel.app.languages.all.map((value) => html`<option value="${value}" ${value === lang ? html`selected` : ""}>${value}</option>`)}</select></label>
      <button type=submit>${t`Show`}</button>
    </form>` : ""}
    <p role=status></p>
    <div class="${write ? "" : "u2-grid"}" style="--u2-Items-width:30rem">
      <section class=u2-card data-event-content>
        <h3 class=-head id="event-${id}-content">${t`Content`}</h3>
        <form data-event-texts aria-labelledby="event-${id}-content">
          <input type=hidden name=id value="${event.id}"><input type=hidden name=lang value="${lang}">
          <fieldset class=u2-unstyle style="display:block" ${!write ? html`disabled` : ""}>
            <legend hidden>${t`Content`}</legend>
            <div class="u2-flex -Col">
              <label for="event-${id}-title">${t`Title`}<input id="event-${id}-title" name=title value="${title}" required></label>
              <label for="event-${id}-location">${t`Location`}<input id="event-${id}-location" name=location value="${await text("location")}"></label>
              <label for="event-${id}-main">${t`Description`}</label>
              <u2-rte name=main><textarea id="event-${id}-main" name=main rows=12 ${!write ? html`readonly` : ""}>${await text("main")}</textarea></u2-rte>
              ${write ? html`<output data-save-state role=status></output>` : ""}
            </div>
          </fieldset>
        </form>
        ${write ? html.async`<form data-event-move>
          <input type=hidden name=event value="${id}">
          <label>${t`Category`}<select name=category required>${categories.filter((category) => category.write).map((category) => html`<option value="${category.node.id}" ${category.node.id === Number(event.vs.basis) ? html`selected` : ""}>${category.title}</option>`)}</select></label>
          <output data-save-state role=status></output>
        </form>` : ""}
      </section>
      ${write ? html`<div data-event-widget="${id}" data-widget-src="${event.modUrl}pub/widget.js"></div>` : html.async`<section class=u2-card>
        <h3 class=-head>${t`Dates`}</h3>
        ${blocks.length ? html`<ul>${formatDates(blocks, ctx.lang, String(event.settings.time_zone() ?? "UTC")).map((date) => html`<li>${date}</li>`)}</ul>` : html.async`<p>${t`No date yet`}</p>`}
      </section>`}
    </div>
  </div>`;
}
