import { hee, html } from "@qino/qino";
import { listen, shopT } from "@qino/qino/cms.shop";

import type { App, HtmlString, Row } from "@qino/qino";
import type { Currency, Line, Product } from "@qino/qino/cms.shop";

export { default as dbSchema } from "./dbschema.json" with { type: "json" };

type Picked = Record<string, string>;
const picked = (data: unknown): Picked | undefined => (data as { options?: Picked } | null)?.options;
const valuesOf = (app: App, product: unknown) => app.db.query`SELECT * FROM shop_option_value WHERE product_id = ${product} ORDER BY sort, value`;
const namesOf = (app: App, product: unknown) => app.db.col<string>`SELECT name FROM shop_option WHERE product_id = ${product} ORDER BY sort, name`;

/** The surcharge of what was picked, per unit or per line. */
async function surcharge(app: App, product: unknown, data: unknown, perLine: boolean): Promise<number> {
  const chosen = picked(data);
  if (!chosen) return 0;
  const hit = (v: Row) => chosen[String(v.name)] === String(v.value) && !!Number(v.per_line) === perLine;
  return (await valuesOf(app, product)).filter(hit).reduce((sum, v) => sum + Number(v.price), 0);
}

export function init(app: App, { signal }: { signal: AbortSignal }): void {
  const t = shopT(app);
  const on = listen(app, signal);
  const inCurrency = (amount: number, currency?: Currency) => currency ? currency.change(amount) : amount;

  // per unit before the discount, so it counts in; per line after it
  on("shop:price-additions", async (e) => { e.price += inCurrency(await surcharge(app, e.product.$id, e.data, false), e.currency); });
  on("shop:price-final", async (e) => { e.price += inCurrency(await surcharge(app, e.product.$id, e.data, true), e.currency) / (e.quantity || 1); });

  on("shop:line-description", (e: { line: Line; description: string }) => {
    const parts = Object.entries(picked(e.line.dataOf()) ?? {}).map(([name, value]) => hee(`${name}: ${value}`));
    if (parts.length) e.description = [e.description, ...parts].filter(Boolean).join("\n");
  });

  on("shop:line-check", async ({ line, errors }: { line: Line; errors: Record<string, string> }) => {
    const names = await namesOf(app, line.product_id);
    if (!names.length) return;
    const chosen = picked(line.dataOf()) ?? {}, values = await valuesOf(app, line.product_id);
    for (const name of names) {
      if (!values.some((v) => v.name === name && v.value === chosen[name])) errors[`option ${name}`] = `${await t`Please choose`}: ${name}`;
    }
  });

  on("shop:product-fields", async ({ product, currency, fields }: { product: Product; currency?: Currency; fields: HtmlString[] }) => {
    const names = await namesOf(app, product.$id);
    if (!names.length) return;
    const values = await valuesOf(app, product.$id);
    const label = (v: Row) => {
      const on = inCurrency(Number(v.price), currency);
      return on && currency ? `${v.value} (+ ${currency.show(on)})` : String(v.value);
    };
    for (const name of names) {
      fields.push(html`<label class=-option><span class=-label>${name}</span>
        <select required name="options[${name}]"><option value="">${values.filter((v) => v.name === name).map((v) => html`<option value="${v.value}">${label(v)}`)}</select></label>`);
    }
  });
}
