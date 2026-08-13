import { shp3 } from "@qino/qino/shp3";

import type { App } from "@qino/qino";

export async function init(app: App): Promise<void> {
  await shp3(app).registerMethod("payments", "invoice", "Rechnung");
}
