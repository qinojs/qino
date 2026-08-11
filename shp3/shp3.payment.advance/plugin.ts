import type { App } from "../../module/core/mod.ts";
import { shp3 } from "../shp3/mod.ts";

export async function init(app: App): Promise<void> {
  await shp3(app).registerMethod("payments", "advance", "Vorauskasse");
}
