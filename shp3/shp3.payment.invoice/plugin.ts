import type { App } from "../../module/core/mod.ts";
import { registerMethod } from "../shp3/mod.ts";

export const name = "shp3.payment.invoice";
export const description = "Payment method: pay by invoice after delivery.";
export const needs = ["shp3"];

export async function init(app: App): Promise<void> {
  await registerMethod(app, "payments", "invoice", "Rechnung");
}
