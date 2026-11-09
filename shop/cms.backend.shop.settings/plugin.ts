import { getCtx, html, sql } from "@qino/qino";
import { backend } from "@qino/qino/cms.backend";
import { renderRows, saveRows } from "@qino/qino/cms.backend.shop";
import { countries, listOf, mainCurrency, settingsOf, shopT } from "@qino/qino/cms.shop";
import { methods } from "@qino/qino/fin.payment";
import { country } from "@qino/qino/locale.country";

import manifest from "./manifest.json" with { type: "json" };

import type { App, Ctx, HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";
import type { Column, Rows } from "@qino/qino/cms.backend.shop";

const { name } = manifest;
const OWN = ["taxIncluded", "country", "payments", "shippings"];

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, name, { en: "Settings", de: "Einstellungen" });
}
export async function uninstall({ app }: { app: App }): Promise<void> {
  await backend.uninstall(app, name);
}

async function tables(app: App): Promise<Rows[]> {
  const t = shopT(app), own = (row: Record<string, unknown>) => String(row.id), isMain = (row: Record<string, unknown>) => !!Number(row.main);
  const currencies = await app.db.col<string>`SELECT id FROM shop_currency ORDER BY id`;
  const minimum: Column[] = app.modules.get("cms.shop.minimum")
    ? [{ name: "minimum", label: t`Minimum order`, type: "money", currency: own }, { name: "minimum_surcharge", label: t`Surcharge below it`, type: "money", currency: own }]
    : [];
  return [{
    table: "shop_currency",
    title: t`Currencies`,
    order: ["-main", "-active", "id"],
    keep: isMain,
    columns: [
      { name: "id", label: "ISO" },
      { name: "factor", label: t`Factor`, type: "number", locked: isMain },
      { name: "rounding", label: t`Rounding step`, type: "number" },
      { name: "closing", label: t`Rounding of the total`, type: "number" },
      { name: "active", label: t`Active`, type: "checkbox", locked: isMain },
      { name: "main", label: t`Main`, type: "checkbox", reload: true },
      ...minimum,
    ],
  }, {
    table: "country",
    title: t`Countries`,
    fixed: true,
    order: ["-shop_enabled", "id"],
    columns: [
      { name: "shop_enabled", label: t`Delivers there`, type: "checkbox" },
      { label: t`Country`, show: (row) => `${country.name(String(row.id), getCtx().lang)} (${row.id})` },
      { name: "shop_tax_rate", label: t`VAT %`, type: "number" },
      { name: "shop_currency", label: t`Pays in`, type: "select", options: [["", ""], ...currencies.map((c) => [c, c] as [string, string])] },
    ],
  }];
}

/** What the shop says about itself; the address and the sender are identity's. */
async function general(node: Node, ctx: Ctx): Promise<HtmlString> {
  const app = node.app, t = shopT(app), set = settingsOf(app);
  const here = String(await set.country ?? "");
  const collator = new Intl.Collator(ctx.lang), name = (id: string) => country.name(id, ctx.lang);
  const ids = (await countries(app)).sort((a, b) => collator.compare(name(a), name(b)));
  const identity = await node.cms.nodeByModule("cms.backend.config.identity");
  return html.async`<div class=u2-card data-settings>
  <div class=-head>${t`Shop`}</div>
  <table class=u2-table>
    <tr><th>${t`Where the shop stands`}
      <td><select name=country><option>${ids.map((id) => html`<option value="${id}" ${id === here ? html`selected` : ""}>${name(id)}`)}</select>
    <tr><th>${t`Prices include VAT`}
      <td><input type=checkbox name=taxIncluded ${await set.taxIncluded !== false ? html`checked` : ""}>
    <tr><th>${t`Payment methods offered`}
      <td><input name=payments value="${String(await set.payments ?? "")}" placeholder="${t`All that fit`}">
    <tr><th>${t`Delivery methods offered`}
      <td><input name=shippings value="${String(await set.shippings ?? "")}" placeholder="${t`All that fit`}">
    ${identity ? html.async`<tr><th>${t`Address`}<td><a href="${identity.url()}">${identity.showTitle()}</a>` : ""}
  </table>
</div>`;
}

/** What the customer reads for each method, per language. */
async function labels(node: Node): Promise<HtmlString> {
  const app = node.app, t = shopT(app), set = settingsOf(app), langs = app.languages.all;
  const main = await mainCurrency(app);
  const offer = { amount: 10000, currency: main?.$id ?? "", country: String(await set.country ?? "") };
  const names = [...new Set([...await listOf(set.shippings), ...await listOf(set.payments), ...(await methods(app, offer)).map((m) => m.method)])];
  const rows = [];
  for (const method of names) {
    const cells = [];
    for (const lang of langs) cells.push(html`<td><input name="labels|${method}|${lang}" value="${String(await set.labels[method]?.[lang] ?? "")}" aria-label="${method} ${lang}">`);
    rows.push(html`<tr><th>${method}${cells}`);
  }
  return html.async`<div class=u2-card data-settings>
  <div class=-head>${t`What the customer reads`}</div>
  <table class=u2-table>
    <thead><tr><th>${t`Method`}${langs.map((l) => html`<th>${l}`)}
    <tbody>${rows}
  </table>
</div>`;
}

async function render(node: Node, { ctx }: { ctx: Ctx }) {
  return html.async`<div class=u2-flex>
  ${general(node, ctx)}
  ${labels(node)}
  ${(await tables(node.app)).map((spec) => renderRows(node, spec))}
</div>`;
}

/** Node access is the permission: whoever may open this page may change these. */
async function api(node: Node, vars: Record<string, unknown>) {
  const app = node.app, set = settingsOf(app);
  if (vars.setting != null) {
    const [key, method, lang] = String(vars.setting).split("|");
    if (key === "labels" && method && app.languages.all.includes(lang)) await set.labels[method][lang](String(vars.value ?? ""));
    else if (OWN.includes(key)) await set[key](key === "taxIncluded" ? !!vars.value : String(vars.value ?? ""));
    else return { ok: false };
    return { ok: true };
  }
  const saved = await saveRows(node, await tables(app), vars);
  // one main currency: whichever was marked last, and it is active
  const values = vars.values as Record<string, unknown> | undefined;
  if (saved?.ok && vars.table === "shop_currency" && values?.main && vars.id != null) {
    const db = app.db.table("shop_currency");
    for (const id of await app.db.col<string>`SELECT id FROM shop_currency WHERE ${sql.id("main")} = ${true} AND id <> ${String(vars.id)}`) await db.update(id, { main: false });
    await db.update(String(vars.id), { active: true });
  }
  return saved;
}

export const cms = { node: { render, api, js: ["../cms.backend.shop/pub/rows.js"] } };
