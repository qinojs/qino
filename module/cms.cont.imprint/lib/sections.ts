import { html } from "@qino/qino";

import type { Ctx } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

/** A block of a legal page: an editable text starting from `initial`, switched by the setting `name`;
 *  `owner` appends the owner's details from identity. */
type Section = {
  name: string; description: string; initial: Record<string, string>; on?: boolean; owner?: boolean;
};

/** One switch per section, defaulting to `on`. */
export const sectionSettings = (sections: Section[]) => ({
  properties: Object.fromEntries(sections.map(({ name, description, on = true }) =>
    [name, { type: "boolean", default: on, description }])),
});

/** The switched-on sections, then a free area for whatever a site needs beyond them. */
export const renderSections = (sections: Section[]) => (node: Node, { ctx }: { ctx: Ctx }) => {
  const shown = sections.filter(({ name }) => node.settings[name]<boolean>());
  return html.async`<div>
  ${hint(node)}
  ${shown.map(({ name, initial, owner: o }) =>
    html.async`<section>${node.cms.text(node, name, { initial })}${o ? owner(node, ctx.lang) : ""}</section>`)}
  ${node.cont("more", "cms.cont.flexible")}
</div>`;
};

/** The owner's details, read from identity on every render: a new address shows at once. */
async function owner(node: Node, lang: string) {
  const { t, settings: { identity: id } } = node.app;
  const { organization: org, contact } = id, adr = org.address;
  const [legalName, orgName, siteName, extended, street, zip, city, country, email, phone, taxID, vatID] =
    await Promise.all([
      org.legalName, org.name, id.name, adr.extendedAddress, adr.streetAddress, adr.postalCode,
      adr.addressLocality, adr.addressCountry, contact.email, contact.telephone, org.taxID, org.vatID,
    ].map(async (item) => String(await item ?? "").trim()));
  const region = country && new Intl.DisplayNames([lang], { type: "region" }).of(country.toUpperCase());
  const blocks = [
    [legalName || orgName || siteName, extended, street, [zip, city].filter(Boolean).join(" "), region],
    [
      email && html`${await t`Email`}: <a href="mailto:${email}">${email}</a>`,
      phone && html`${await t`Phone`}: <a href="tel:${phone.replace(/\(0\)|[^\d+]/g, "")}">${phone}</a>`,
    ],
    [taxID && `${await t`Tax ID`}: ${taxID}`, vatID && `${await t`VAT number`}: ${vatID}`],
  ].map((lines) => lines.filter(Boolean)).filter((lines) => lines.length);
  return html`${blocks.map((lines) => html`<p>${html.join(lines, "<br>")}</p>`)}`;
}

async function hint(node: Node) {
  if (!await node.edit()) return "";
  const { t } = node.app;
  // the identity's backend page, where whoever may open it changes name and address
  const backend = await node.cms.nodeByModule("cms.backend.config.identity");
  const page = backend && await backend.isReadable() ? await backend.page() : undefined;
  const source = await t`Name, address and numbers come from the identity.`;
  return html.async`<u2-alert open variant=info>
  ${t`A template, not legal advice: check that the texts match what this website really does.`}
  ${page ? html.async`<a href="${page.url()}">${source}</a>` : source}
</u2-alert>`;
}
