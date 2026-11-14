import { getCtx, html, sql } from "@qino/qino";
import { backend } from "@qino/qino/cms.backend";
import { renderRows, saveRows } from "@qino/qino/cms.backend.shop";
import { countries, currencies as activeCurrencies, listOf, mainCurrency, settingsOf, shippingMethods, shopT } from "@qino/qino/cms.shop";
import { methods } from "@qino/qino/fin.payment";
import { country } from "@qino/qino/locale.country";

import manifest from "./manifest.json" with { type: "json" };

import type { App, Ctx, HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";
import type { Method } from "@qino/qino/cms.shop";
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
  // a currency is picked, not typed: those the shop does not price in yet
  const others = (await app.db.col<string>`SELECT id FROM currency ORDER BY id`).filter((id) => !currencies.includes(id));
  const collator = new Intl.Collator(getCtx().lang), named = (row: Record<string, unknown>) => country.name(String(row.id), getCtx().lang);
  // what an unassigned country pays in: its own currency if the shop offers it, else the main one
  const active = await activeCurrencies(app), main = active[0] ?? "", auto = await t`Auto`;
  const pays = (row?: Record<string, unknown>) => active.includes(String(row?.currency)) ? row!.currency : main;
  const minimum: Column[] = app.modules.get("cms.shop.minimum")
    ? [{ name: "minimum", label: t`Minimum order`, type: "money", currency: own }, { name: "minimum_surcharge", label: t`Surcharge below it`, type: "money", currency: own }]
    : [];
  return [{
    table: "shop_currency",
    title: t`Currencies`,
    order: ["-main", "-active", "id"],
    keep: isMain,
    columns: [
      { name: "id", label: "ISO", type: "select", options: others.map((id) => [id, id]) },
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
    // where the shop delivers first, then by name as the reader spells it
    sort: (a, b) => Number(b.shop_enabled) - Number(a.shop_enabled) || collator.compare(named(a), named(b)),
    columns: [
      { name: "shop_enabled", label: t`Delivers there`, type: "checkbox" },
      { label: t`Country`, show: (row) => `${named(row)} (${row.id})` },
      { name: "shop_tax_rate", label: t`VAT %`, type: "number" },
      { name: "shop_currency", label: t`Pays in`, type: "select", options: (row) => [["", `${auto} (${pays(row)})`], ...currencies.map((c) => [c, c] as [string, string])] },
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
  return html.async`<div class=u2-card data-settings style="flex:0 1 auto">
  <div class=-head>${t`Shop`}</div>
  <table class=u2-table>
    <tr><th>${t`Where the shop stands`}
      <td><select name=country><option>${ids.map((id) => html`<option value="${id}" ${id === here ? html`selected` : ""}>${name(id)}`)}</select>
    <tr><th>${t`Prices include VAT`}
      <td><input type=checkbox name=taxIncluded ${await set.taxIncluded !== false ? html`checked` : ""}>
    ${identity ? html.async`<tr><th>${t`Address`}<td><a href="${identity.url()}">${identity.showTitle()}</a>` : ""}
  </table>
</div>`;
}

/**
 * The methods of one kind: those that are on, in the order of the rows, are what the shop offers —
 * dragging sorts, so there is no name to type. Beside each, what the customer reads, per language.
 */
async function offered(node: Node, kind: "payments" | "shippings", all: Method[]): Promise<HtmlString> {
  const app = node.app, t = shopT(app), set = settingsOf(app), langs = app.languages.all;
  const listed = await listOf(set[kind]), reorder = await t`Reorder`;
  const rows = [];
  // the listed ones first, as listed; an empty list offers all
  for (const name of new Set([...listed, ...all.map((m) => m.name)])) {
    const own = all.find((m) => m.name === name)?.label;
    const cells = [];
    for (const lang of langs) cells.push(html`<td><input name="labels|${name}|${lang}" value="${await set.labels[name]?.[lang]}" placeholder="${own}" aria-label="${name} ${lang}">`);
    rows.push(html`<tr data-method="${name}" draggable=false>
      <td><input type=checkbox ${!listed.length || listed.includes(name) ? html`checked` : ""} aria-label="${name}">
      <td>${name}${cells}
      <td><button type=button class=u2-unstyle u2-draghandle title="${reorder}"><u2-ico icon=drag_indicator>⠿</u2-ico></button>`);
  }
  return html.async`<div class=-head>${kind === "payments" ? t`Payment` : t`Delivery`}</div>
  <table class=u2-table>
    <thead><tr><th>${t`Active`}<th>${t`Method`}${langs.map((l) => html`<th>${l}`)}<th>
    <tbody data-methods=${kind} u2-dropzone>${rows}
  </table>`;
}

/** What the shop offers to pay and to deliver with. */
async function methodsCard(node: Node): Promise<HtmlString> {
  const app = node.app, set = settingsOf(app);
  const main = await mainCurrency(app);
  const offer = { amount: 10000, currency: main?.$id ?? "", country: String(await set.country ?? "") };
  const payments = (await methods(app, offer)).map((m) => ({ name: m.method, label: m.label }));
  return html.async`<div class=u2-card data-settings style="flex:0 1 auto">
  ${offered(node, "payments", payments)}
  ${offered(node, "shippings", await shippingMethods(app))}
</div>`;
}

async function render(node: Node, { ctx }: { ctx: Ctx }) {
  return html.async`<div class=u2-flex>
  ${general(node, ctx)}
  ${methodsCard(node)}
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

export const cms = { node: { render, api, js: ["../cms.backend.shop/pub/rows.js", "pub/main.js"] } };
