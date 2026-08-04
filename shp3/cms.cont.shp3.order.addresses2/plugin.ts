import { html, type HtmlString, type Ctx } from "../../module/core/mod.ts";
import type { Node } from "../../module/cms/mod.ts";
import { cart, shopCountries, type Order } from "../shp3/mod.ts";
import { country } from "../../module/locale.country/mod.ts";
import dbSchema from "./dbschema.json" with { type: "json" };

export const name = "cms.cont.shp3.order.addresses2";
export const description = "Billing and delivery address of the order.";
export const needs = ["shp3", "cms"];
export { dbSchema };

const REQUIRED = new Set(["firstname", "lastname", "street", "zip", "city", "country", "email"]);

const settingsSchema = {
  properties: {
    shipping_address: { type: "boolean", default: true, description: "Whether a separate delivery address can be given." },
  },
};

async function render(node: Node, { ctx }: { ctx: Ctx }): Promise<HtmlString> {
  const t = node.app.t;
  const order = await cart(ctx, false);
  if (!order) return html.async`<div></div>`;

  const separate = await node.settings.shipping_address() !== false;
  return html.async`<div>
  <form class=-addresses>
    <fieldset class=-bill>
      <legend>${t`Billing address`}</legend>
      ${await fields(node, order, "bill", ctx.lang)}
    </fieldset>
    ${separate
      ? html`<label class=-unlike>
      <input type=checkbox name=ship_unlike_bill value=1 ${order.ship_unlike_bill ? html.raw("checked") : ""}>
      ${await t`Deliver to a different address`}
    </label>
    <fieldset class=-ship ${order.ship_unlike_bill ? html.raw("") : html.raw("hidden")}>
      <legend>${await t`Delivery address`}</legend>
      ${await fields(node, order, "ship", ctx.lang)}
    </fieldset>`
      : ""}
  </form>
</div>`;
}

// What the browser may fill in, per field — the second half of the autocomplete token.
const AUTO: Record<string, string> = {
  company: "organization",
  salutation: "honorific-prefix",
  firstname: "given-name",
  lastname: "family-name",
  street: "street-address",
  zip: "postal-code",
  city: "address-level2",
  country: "country",
  phone: "tel",
  email: "email",
};

async function fields(node: Node, order: Order, side: "bill" | "ship", lang: string) {
  const t = node.app.t;
  const labels = {
    company: t`Company`,
    salutation: t`Salutation`,
    firstname: t`First name`,
    lastname: t`Last name`,
    street: t`Street`,
    zip: t`ZIP`,
    city: t`City`,
    country: t`Country`,
    phone: t`Phone`,
    email: t`E-mail`,
  };
  const rows: HtmlString[] = [];
  for (const [field, title] of Object.entries(labels)) {
    const name = `${side}_${field}`;
    if (!order.$table.field(name)) continue;
    const required = side === "bill" && REQUIRED.has(field);
    const autocomplete = `${side === "bill" ? "billing" : "shipping"} ${AUTO[field]}`;
    rows.push(html`<label>
      <span>${await title}</span>
      ${field === "country"
        ? await countryField(node, name, String(order.$get(name) ?? ""), autocomplete, required, lang)
        : html`<input name=${name} value="${order.$get(name)}" autocomplete="${autocomplete}"
        ${field === "email" ? html.raw("type=email") : html.raw("")}
        ${required ? html.raw("required") : html.raw("")}>`}
    </label>`);
  }
  return html.join(rows);
}

/** The countries the shop delivers to, named in the visitor's language. */
async function countryField(node: Node, name: string, value: string, autocomplete: string, required: boolean, lang: string) {
  const options = (await shopCountries(node.app.db)).map((id) => ({ id, title: country.name(id, lang) }));
  options.sort((a, b) => new Intl.Collator(lang).compare(a.title, b.title));
  return html`<select name=${name} autocomplete="${autocomplete}" ${required ? html.raw("required") : html.raw("")}>
      <option value="">
      ${html.join(options.map((c) => html`<option value=${c.id} ${c.id === value ? html.raw("selected") : ""}>${c.title}`))}
    </select>`;
}

export const cms = { node: { render, js: ["../shp3/pub/shp3.js", "pub/main.js"], settingsSchema } };
