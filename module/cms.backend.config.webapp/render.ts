import { $item, html, toInput } from "@qino/qino";
import * as identity from "@qino/qino/identity";

import { preview } from "./preview.ts";

import type { App, Ctx, HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

async function field(app: App, path: string, label: string | Promise<string>) {
  const item = app.settings[$item].sub(["webapp", path]);
  return html.async`<tr>
  <th>${label}
  <td>${html.raw(toInput(item.schema ?? {}, { name: path, value: await item.proxy }))}`;
}

async function inheritedField(app: App, path: string, label: string | Promise<string>) {
  const item = app.settings[$item].sub(["identity", ...path.split(".")]);
  return html.async`<tr>
  <th>${label}
  <td>${html.raw(toInput({ ...item.schema, readOnly: true }, { value: String(await item.proxy ?? "").trim(), disabled: true }))}`;
}

async function iconField(app: App, label: string | Promise<string>) {
  const icon = await (await identity.file(app, "icon"))?.exists();
  return html.async`<tr>
  <th>${label}
  <td>${icon ? html.async`<img src="${icon.url({ h: 64 })}" alt="" style="display:block;max-height:4rem;max-width:4rem">` : "—"}`;
}

const card = (
  title: string | Promise<string>,
  fields: (HtmlString | Promise<HtmlString>)[],
  footer?: HtmlString | Promise<HtmlString>,
  editable = true,
) => html.async`<div class=u2-card style="flex-grow:auto">
  <div class=-head>${title}${editable ? html` <small data-status aria-live=polite></small>` : ""}</div>
  <table class=u2-table>${fields}</table>
  ${footer ? html.async`<div class=-body>${footer}</div>` : ""}
</div>`;

export async function render(node: Node, { ctx }: { ctx: Ctx }): Promise<HtmlString> {
  const app = node.app;
  const t = app.t;
  const identityNode = await node.cms.nodeByModule("cms.backend.config.identity");
  const identityUrl = identityNode ? await identityNode.url() : "";
  const identityNote = html.async`${t`Name, description, colors and the app icon are managed by the`} ${
    identityUrl ? html.async`<a href="${identityUrl}">${t`Identity module`}</a>` : t`Identity module`
  }.`;
  return html.async`<div class=u2-flex>
  ${card(t`Launch`, [
    field(app, "display", t`Display`),
    field(app, "orientation", t`Orientation`),
  ], html.async`<a href="${ctx.req.appUrl}manifest.webmanifest" target=_blank>${t`Open manifest`}</a>`)}
  ${card(t`Identity`, [
    inheritedField(app, "name", t`Name`),
    inheritedField(app, "alternateName", t`Short name`),
    inheritedField(app, "description", t`Description`),
    inheritedField(app, "brand.primaryColor", t`Theme color`),
    inheritedField(app, "brand.backgroundColor", t`Background color`),
    iconField(app, t`Icon`),
  ], identityNote, false)}
  ${card(t`Catalog`, [
    field(app, "categories", t`Categories`),
  ])}
  ${card(t`Browser integration`, [
    field(app, "telephoneDetection", t`Telephone detection`),
    field(app, "appleStatusBarStyle", t`Apple status bar`),
  ])}
  ${preview(node, ctx)}
</div>`;
}
