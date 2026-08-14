import { $item, html, toInput } from "@qino/qino";
import * as identity from "@qino/qino/identity";

import type { App, HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

async function field(app: App, path: string, label: string, required = false): Promise<HtmlString> {
  const item = app.settings[$item].sub(["identity", ...path.split(".")]);
  return html`<tr>
  <th>${label}
  <td>${html.raw(toInput(item.schema ?? {}, { name: path, value: String(await item.proxy ?? "").trim(), required }))}`;
}

const card = (title: string, save: string, fields: Array<HtmlString | Promise<HtmlString>>) => html.async`<form class=u2-card data-identity style="flex:1 1 24rem">
  <div class=-head>${title}</div>
  <table class=u2-table>${fields}</table>
  <div class=-body><button type=submit>${save}</button> <span data-status></span></div>
</form>`;

export async function render(node: Node): Promise<HtmlString> {
  const app = node.app;
  const t = app.t;
  const save = await t`Save`;
  return html.async`<div class=u2-flex>
  ${card(await t`Portal`, save, [
    field(app, "name", await t`Name`, true),
    field(app, "alternateName", await t`Short name`),
    field(app, "description", await t`Description`),
    field(app, "url", await t`Website`),
  ])}
  ${card(await t`Organization`, save, [
    field(app, "organization.name", await t`Name`),
    field(app, "organization.legalName", await t`Legal name`),
    field(app, "organization.taxID", await t`Tax ID`),
    field(app, "organization.vatID", await t`VAT ID`),
  ])}
  ${card(await t`Address`, save, [
    field(app, "organization.address.streetAddress", await t`Street address`),
    field(app, "organization.address.extendedAddress", await t`Address addition`),
    field(app, "organization.address.postalCode", await t`Postal code`),
    field(app, "organization.address.addressLocality", await t`City`),
    field(app, "organization.address.addressRegion", await t`Region`),
    field(app, "organization.address.addressCountry", await t`Country code`),
  ])}
  ${card(await t`Contact`, save, [
    field(app, "contact.name", await t`Name`),
    field(app, "contact.email", await t`Email`),
    field(app, "contact.telephone", await t`Telephone`),
  ])}
  <form class=u2-card data-identity data-brand style="flex:1 1 auto">
    <div class=-head>${t`Brand`}</div>
    <table class=u2-table>
      ${field(app, "brand.fontFamily", await t`Font family`)}
      ${field(app, "brand.primaryColor", await t`Primary color`)}
      ${field(app, "brand.accentColor", await t`Accent color`)}
      ${field(app, "brand.backgroundColor", await t`Background color`)}
      ${asset(node, "logo", await t`Logo`, "image/*")}
      ${asset(node, "icon", await t`Icon`, "image/*")}
      ${asset(node, "font", await t`Font file`, ".woff2,.woff,.ttf,.otf")}
    </table>
    <div class=-body><button type=submit>${save}</button> <span data-status></span></div>
  </form>
</div>`;
}

async function asset(node: Node, name: string, label: string, accept: string): Promise<HtmlString> {
  const existing = await (await identity.file(node.app, name))?.exists();
  // An image shows itself, anything else (the font) its file name.
  const shown = existing && (existing.mime.startsWith("image/")
    ? html`<img src="${await existing.url({ h: 96 })}" alt="${existing.name}" style="max-height:9rem"><br>`
    : existing.name);
  return html.async`<tr data-asset=${name}>
  <th>${label}
  <td>
    ${existing ? html`<a href="${await existing.url()}" target=_blank>${shown}</a> ` : ""}
    <input type=file accept="${accept}">
    ${existing ? html`<button type=button data-remove u2-confirm="${await node.app.t`Remove this file?`}">×</button>` : ""}`;
}
