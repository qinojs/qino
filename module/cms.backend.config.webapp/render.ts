import { $item, html, toInput } from "@qino/qino";
import * as identity from "@qino/qino/identity";

import { preview } from "./preview.ts";

import type { App, Ctx, HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

async function field(app: App, path: string, label: string): Promise<HtmlString> {
  const item = app.settings[$item].sub(["webapp", path]);
  return html`<tr>
  <th>${label}
  <td>${html.raw(toInput(item.schema ?? {}, { name: path, value: await item.proxy }))}`;
}

async function inheritedField(app: App, path: string, label: string): Promise<HtmlString> {
  const item = app.settings[$item].sub(["identity", ...path.split(".")]);
  return html`<tr>
  <th>${label}
  <td>${html.raw(toInput({ ...item.schema, readOnly: true }, { value: String(await item.proxy ?? "").trim(), disabled: true }))}`;
}

async function iconField(app: App, label: string): Promise<HtmlString> {
  const icon = await (await identity.file(app, "icon"))?.exists();
  return html.async`<tr>
  <th>${label}
  <td>${icon ? html`<img src="${await icon.url({ h: 64 })}" alt="" style="display:block;max-height:4rem;max-width:4rem">` : "—"}`;
}

const card = (
  title: string,
  fields: Array<HtmlString | Promise<HtmlString>>,
  footer?: HtmlString | Promise<HtmlString>,
  editable = true,
) => html.async`<div class=u2-card style="flex-grow:auto">
  <div class=-head>${title}${editable ? html` <small data-status aria-live=polite></small>` : ""}</div>
  <table class=u2-table>${fields}</table>
  ${footer ? html`<div class=-body>${footer}</div>` : ""}
</div>`;

export async function render(node: Node, { ctx }: { ctx: Ctx }): Promise<HtmlString> {
  const app = node.app;
  const t = app.t;
  const identityNode = await node.cms.nodeByModule("cms.backend.config.identity");
  const identityUrl = identityNode ? await identityNode.url() : "";
  const identityNote = html`${await t`Name, description, colors and the app icon are managed by the`} ${
    identityUrl ? html`<a href="${identityUrl}">${await t`Identity module`}</a>` : await t`Identity module`
  }.`;
  return html.async`<div class=u2-flex>
  ${card(await t`Launch`, [
    field(app, "display", await t`Display`),
    field(app, "orientation", await t`Orientation`),
  ], html`<a href="${ctx.req.appUrl}manifest.webmanifest" target=_blank>${await t`Open manifest`}</a>`)}
  ${card(await t`Identity`, [
    inheritedField(app, "name", await t`Name`),
    inheritedField(app, "alternateName", await t`Short name`),
    inheritedField(app, "description", await t`Description`),
    inheritedField(app, "brand.primaryColor", await t`Theme color`),
    inheritedField(app, "brand.backgroundColor", await t`Background color`),
    iconField(app, await t`Icon`),
  ], identityNote, false)}
  ${card(await t`Catalog`, [
    field(app, "categories", await t`Categories`),
  ])}
  ${card(await t`Browser integration`, [
    field(app, "telephoneDetection", await t`Telephone detection`),
    field(app, "appleStatusBarStyle", await t`Apple status bar`),
  ])}
  ${preview(node, ctx)}
</div>`;
}
