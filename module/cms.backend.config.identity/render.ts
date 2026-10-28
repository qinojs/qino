import { $item, html, toInput } from "@qino/qino";
import * as identity from "@qino/qino/identity";

import type { App, HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

async function field(app: App, path: string, label: string | Promise<string>, required = false) {
  const item = app.settings[$item].sub(["identity", ...path.split(".")]);
  return html.async`<tr>
  <th>${label}
  <td>${html.raw(toInput(item.schema ?? {}, { name: path, value: String(await item.proxy ?? "").trim(), required }))}`;
}

const card = (title: string | Promise<string>, fields: (HtmlString | Promise<HtmlString>)[]) =>
  html.async`<div class=u2-card style="flex-grow:25rem">
  <div class=-head>${title} <small data-status aria-live=polite></small></div>
  <table class="u2-table -Fields -Flex">${fields}</table>
</div>`;

export async function render(node: Node): Promise<HtmlString> {
  const app = node.app;
  const t = app.t;
  return html.async`<div class=u2-flex>
  ${card(t`Portal`, [
    field(app, "name", t`Name`, true),
    field(app, "alternateName", t`Short name`),
    field(app, "description", t`Description`),
    field(app, "url", t`Website`),
  ])}
  ${card(t`Organization`, [
    field(app, "organization.name", t`Name`),
    field(app, "organization.legalName", t`Legal name`),
    field(app, "organization.taxID", t`Tax ID`),
    field(app, "organization.vatID", t`VAT ID`),
  ])}
  ${card(t`Address`, [
    field(app, "organization.address.streetAddress", t`Street address`),
    field(app, "organization.address.extendedAddress", t`Address addition`),
    field(app, "organization.address.postalCode", t`Postal code`),
    field(app, "organization.address.addressLocality", t`City`),
    field(app, "organization.address.addressRegion", t`Region`),
    field(app, "organization.address.addressCountry", t`Country code`),
  ])}
  ${card(t`Contact`, [
    field(app, "contact.name", t`Name`),
    field(app, "contact.email", t`Email`),
    field(app, "contact.telephone", t`Telephone`),
  ])}
  <div class=u2-card data-brand style="flex:1 1 auto">
    <div class=-head>${t`Brand`} <small data-status aria-live=polite></small></div>
    <table class=u2-table>
      ${field(app, "brand.fontFamily", t`Font family`)}
      ${field(app, "brand.primaryColor", t`Primary color`)}
      ${field(app, "brand.accentColor", t`Accent color`)}
      ${field(app, "brand.backgroundColor", t`Background color`)}
      ${asset(node, "logo", t`Logo`, "image/*")}
      ${asset(node, "icon", t`Icon`, "image/*")}
      ${asset(node, "font", t`Font file`, ".woff2,.woff,.ttf,.otf")}
    </table>
  </div>
</div>`;
}

async function asset(node: Node, name: string, label: string | Promise<string>, accept: string) {
  const existing = await (await identity.file(node.app, name))?.exists();
  // An image shows itself, anything else (the font) its file name.
  const shown = existing && (existing.mime.startsWith("image/")
    ? html`<img src="${await existing.url({ h: 96 })}" alt="${existing.name}" style="max-height:9rem"><br>`
    : existing.name);
  return html.async`<tr data-asset=${name}>
  <th>${label}
  <td>
    ${existing ? html.async`<a href="${existing.url()}" target=_blank>${shown}</a> ` : ""}
    <input type=file accept="${accept}">
    ${existing ? html.async`<button type=button data-remove u2-confirm="${node.app.t`Remove this file?`}">×</button>` : ""}`;
}
