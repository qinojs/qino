import type { Node } from "@qino/qino/cms";

const CURRENCY = new Set(["factor", "smallest", "smallest_closing", "active", "main"]);

export default async function (node: Node, vars: Record<string, unknown>): Promise<unknown> {
  if (await node.access() < 2) return false;
  const { app } = node;
  const db = app.db;

  if ("setting" in vars) {
    // Only what the panel offers — the settings tree itself is writable far beyond this form.
    const s = app.settings.shp3;
    const path = String(vars.setting);
    const write = {
      "location.country": s.location.country,
      "location.city": s.location.city,
      "location.street": s.location.street,
      "vat.mode": s.vat.mode,
      default_product_module: s.default_product_module,
      auto_select_payment: s.auto_select_payment,
      auto_select_shipping: s.auto_select_shipping,
    }[path];
    if (!write) return false;
    const value = path === "vat.mode" ? (vars.value ? "included" : "excluded")
      : path.startsWith("auto_select_") ? !!vars.value
      : String(vars.value ?? "");
    await write(value);
    return { value };
  }

  if ("method" in vars) {
    const kind = String(vars.kind);
    if (kind !== "payments" && kind !== "shippings") return false;
    // Only a method a module announced — the panel configures, it does not invent methods.
    const setting = app.settings.shp3[kind][String(vars.method)];
    if (await setting.description === undefined) return false;
    const field = String(vars.field ?? "");
    if (field === "enabled") await setting.enabled(!!vars.value);
    else if (field === "description") await setting.description(String(vars.value ?? ""));
    else if (field === "sort") await setting.sort(Number(vars.value) || 0);
    else return false;
    return 1;
  }

  if ("order" in vars) {
    const kind = String(vars.kind);
    if (kind !== "payments" && kind !== "shippings") return false;
    const s = app.settings.shp3[kind];
    let sort = 0;
    // Row order in, sort numbers out — unknown names are silently skipped, like every other write here.
    for (const name of Array.isArray(vars.order) ? vars.order : []) {
      const setting = s[String(name)];
      if (await setting.description !== undefined) await setting.sort(++sort);
    }
    return 1;
  }

  if ("country" in vars) {
    const id = String(vars.country);
    const field = String(vars.field ?? "");
    if (!await db.one`SELECT id FROM country WHERE id = ${id}`) return false;
    if (field === "shp3_enabled") return await db.table("country").update({ id, shp3_enabled: !!vars.value }) ? 1 : false;
    // An empty rate is not "zero percent", it means the country has none of its own.
    if (field === "shp3_default_vat_rate") {
      const rate = String(vars.value ?? "");
      return await db.table("country").update({ id, shp3_default_vat_rate: rate === "" ? null : Number(rate) }) ? 1 : false;
    }
    return false;
  }

  if ("currency" in vars) {
    const id = String(vars.currency);
    const field = String(vars.field ?? "");
    if (!CURRENCY.has(field)) return false;
    if (!await db.one`SELECT id FROM shp3_currency WHERE id = ${id}`) {
      // The shop takes a currency into its list by activating it; the factor arrives with the rates.
      if (field !== "active" || !vars.value || !await db.one`SELECT id FROM currency WHERE id = ${id}`) return false;
      await db.table("shp3_currency").insert({ id, factor: 1, smallest: 0.01, smallest_closing: 0.01, active: true });
      return 1;
    }
    // The main currency is the yardstick: every factor is relative to it, so switching it rescales
    // them all, and the new one starts at 1 — the same move the PHP backend made.
    if (field === "main") {
      const last = Number(await db.one`SELECT factor FROM shp3_currency WHERE id = ${id}`) || 1;
      await db.exec`UPDATE shp3_currency SET factor = factor / ${last}, main = ${false}`;
      await db.table("shp3_currency").update({ id, factor: 1, active: true, main: true });
      return 1;
    }
    // A factor the rate job owns is not the panel's to change.
    if (field === "factor" && String(await app.settings["locale.currency"].update ?? "never") !== "never") return false;
    const value = field === "active" ? !!vars.value : Number(vars.value);
    return await db.table("shp3_currency").update({ id, [field]: value }) ? 1 : false;
  }

  return false;
}
