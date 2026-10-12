import { migrate as renameColumns } from "./renameColumns.ts";
import { namePages } from "./namePages.ts";

import type { App } from "@qino/qino";

/** Before app.init(): what the boot itself would otherwise get wrong. */
export async function migrate(app: App): Promise<void> {
  await renameColumns(app);
  await namePages(app);
}
