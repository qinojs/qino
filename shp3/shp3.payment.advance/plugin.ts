import type { App } from "../../module/core/mod.ts";
import { shp3 } from "../shp3/mod.ts";

export const name = "shp3.payment.advance";
export const description = "Payment method: pay in advance, ship after the money arrived.";
export const needs = ["shp3"];

export async function init(app: App): Promise<void> {
  await shp3(app).registerMethod("payments", "advance", "Vorauskasse");
}
