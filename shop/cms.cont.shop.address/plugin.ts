import { html } from "@qino/qino";
import { country as countryName } from "@qino/qino/locale.country";
import { cart, countries, country as shopCountry, shopT } from "@qino/qino/cms.shop";

import type { Ctx, HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";
import type { Order, Party } from "@qino/qino/cms.shop";

/** The fields of a party, as fin and schema.org name them; the address ones go under address. */
const FIELDS = ["honorificPrefix", "organization", "givenName", "familyName", "streetAddress", "postalCode", "addressLocality", "addressCountry", "telephone", "email"];
const IN_ADDRESS = new Set(["streetAddress", "postalCode", "addressLocality", "addressCountry"]);
const AUTOCOMPLETE: Record<string, string> = {
  honorificPrefix: "honorific-prefix", organization: "organization", givenName: "given-name", familyName: "family-name",
  streetAddress: "street-address", postalCode: "postal-code", addressLocality: "address-level1", addressCountry: "country",
  telephone: "tel", email: "email",
};
const REQUIRED = ["honorificPrefix", "givenName", "familyName", "streetAddress", "postalCode", "addressLocality", "addressCountry", "email"];

const required = { type: "object", properties: Object.fromEntries(FIELDS.map((f) => [f, { type: "boolean", default: REQUIRED.includes(f) }])) };
/** Which fields the customer has to fill in, per party: the shop's, not a page's. */
export const settingsSchema = {
  properties: {
    required: { type: "object", properties: { bill: required, ship: { ...required, properties: { ...required.properties, email: { type: "boolean", default: false } } } } },
  },
};

const nodeSettingsSchema = {
  properties: {
    heading: { type: "integer", default: 2, minimum: 1, maximum: 6, description: "Level of the headings (h2)." },
    editable: { type: "boolean", default: true, description: "The address can be changed here; else it is only shown." },
  },
};

const value = (p: Party | undefined, f: string) =>
  String((IN_ADDRESS.has(f) ? p?.address?.[f] : (p as Record<string, unknown> | undefined)?.[f]) ?? "");

/** The countries to choose from: the current one first, the shop's own next, the rest by name. */
async function choices(node: Node, ctx: Ctx, order?: Order) {
  const first = [order?.country, await shopCountry(node.app)];
  const collator = new Intl.Collator(ctx.lang);
  return (await countries(node.app)).sort((a, b) =>
    (first.indexOf(a) + 1 || 9) - (first.indexOf(b) + 1 || 9) || collator.compare(countryName.name(a, ctx.lang), countryName.name(b, ctx.lang)));
}

async function render(node: Node, { ctx }: { ctx: Ctx }) {
  const app = node.app, t = shopT(app);
  const order = await cart(ctx, false); // showing the form makes no cart
  const where = order?.country || await shopCountry(app);
  const edit = await node.settings.editable() !== false;
  const h = `h${Number(await node.settings.heading() || 2)}`;
  const req = app.settings["cms.cont.shop.address"].required;
  const labels: Record<string, string> = {
    honorificPrefix: await t`Salutation`, organization: await t`Company`, givenName: await t`First name`, familyName: await t`Last name`,
    streetAddress: await t`Street`, postalCode: await t`Postcode`, addressLocality: await t`City`, addressCountry: await t`Country`,
    telephone: await t`Phone`, email: await t`Email`,
  };
  const ids = await choices(node, ctx, order);
  const salutations = [await t`Mr`, await t`Ms`];

  const fields = async (kind: "bill" | "ship", party: Party | undefined): Promise<HtmlString[]> => {
    const rows = [];
    for (const f of FIELDS) {
      const must = await req[kind][f] === true;
      const v = value(party, f) || (f === "addressCountry" && kind === "bill" ? where : "");
      const attrs = html`name="${f}" autocomplete="${(kind === "bill" ? "billing " : "shipping ") + AUTOCOMPLETE[f]}" ${must ? html`required` : ""}`;
      const input = !edit ? (f === "addressCountry" && v ? countryName.name(v, ctx.lang) : v)
        : f === "honorificPrefix" ? html`<select ${attrs}><option>${salutations.map((s) => html`<option ${s === v ? html`selected` : ""}>${s}`)}</select>`
        : f === "addressCountry" ? html`<select ${attrs}><option>${ids.map((id) => html`<option value="${id}" ${id === v ? html`selected` : ""}>${countryName.name(id, ctx.lang)}`)}</select>`
        : html`<input maxlength=40 ${f === "email" ? html`type=email` : ""} ${attrs} value="${v}">`;
      rows.push(html`<label><span class=-label>${labels[f]}: ${edit && must ? "*" : ""}</span><span>${input}</span></label>`);
    }
    return rows;
  };
  const differs = !!order?.ship;
  const goods = !!order && await order.weight() > 0;
  return html.async`<div>
  <form>
    <div class=-bill>
      ${node.cms.text(node, "bill_header", { tag: h, initial: { de: "Rechnungsadresse", en: "Billing address" } })}
      <div class=c1-fieldTable><div>${fields("bill", order?.party("bill"))}</div></div>
    </div>
    ${goods && (edit || differs) ? html.async`<div class=-ship>
      <${html.raw(h)}><label>
        ${edit ? html`<input type=checkbox name=ship_unlike_bill ${differs ? html`checked` : ""} class=c1-fakable><i></i> &nbsp;` : ""}
        ${node.cms.text(node, "ship_header", { tag: "span", initial: { de: "Lieferadresse", en: "Shipping address" } })}
      </label></${html.raw(h)}>
      <div class=-tableWrapper ${differs ? "" : html`hidden`}>
        <div class=c1-fieldTable><div>${fields("ship", differs ? order?.party("ship") : undefined)}</div></div>
      </div>
    </div>` : ""}
  </form>
</div>`;
}

export const cms = { node: { render, js: ["../cms.shop/pub/shop.js", "pub/main.js"], settingsSchema: nodeSettingsSchema } };
