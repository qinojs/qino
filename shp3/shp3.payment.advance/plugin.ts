import type { App } from "@qino/qino";
import { shp3 } from "@qino/qino/shp3";

export async function init(app: App): Promise<void> {
  await shp3(app).registerMethod("payments", "advance", "Vorauskasse");
}
