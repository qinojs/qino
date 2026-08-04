// Payment and shipping methods are settings, not code: a module announces itself once, the shop
// admin enables, describes and sorts it. Same tree as the PHP original — shp3.payments.<name>.*

import { $item, type App, itemReadDeep } from "../../../module/core/mod.ts";
import { settingsOf } from "./shop.ts";
import type { Db } from "../../../module/core/mod.ts";

export type MethodKind = "payments" | "shippings";
type Method = { enabled?: boolean; description?: string; sort?: number };

/** The enabled methods of a kind, in their configured order: name → label. */
export async function methods(db: Db, kind: MethodKind): Promise<Record<string, string>> {
  const all = (await itemReadDeep(settingsOf(db)[kind][$item]) ?? {}) as Record<string, Method>;
  return Object.fromEntries(
    Object.entries(all)
      .filter(([, m]) => m?.enabled ?? true) // a hand-added entry without the flag counts as on
      .sort((a, b) => Number(a[1]?.sort ?? 0) - Number(b[1]?.sort ?? 0))
      .map(([name, m]) => [name, m?.description || name]),
  );
}

/** Announce a method once. Existing settings are never overwritten — they belong to the shop.
 *  Both keys are written, like the PHP install did: a schema default is invisible until the row
 *  exists, and the shop has to see the method in its settings to switch it off. */
export async function registerMethod(app: App, kind: MethodKind, name: string, description: string): Promise<void> {
  const setting = app.settings.shp3[kind][name];
  if (await setting.description !== undefined) return;
  await setting.description(description);
  await setting.enabled("1");
}

/** Pick the method to use: the chosen one, the only one, or the first — per setting. */
export async function pick(db: Db, kind: MethodKind, chosen: string, all: Record<string, string>): Promise<string> {
  const names = Object.keys(all);
  if (names.length === 1) return names[0];
  if (chosen && chosen in all) return chosen;
  const auto = await settingsOf(db)[kind === "payments" ? "auto_select_payment" : "auto_select_shipping"];
  return auto ? names[0] ?? "" : "";
}
