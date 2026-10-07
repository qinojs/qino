import { keyed, safeEqual } from "@qino/qino";

import type { App } from "@qino/qino";

/** Path segment the payer and the providers come back under. */
export const PATH = "payment";

const SIG = 8;

/** `<id>-<signature>`: nobody reaches someone else's payment by counting through ids. */
const tokenOf = async (app: App, id: number) => `${id}-${await keyed(app, ["fin.payment", String(id)], SIG)}`;

/** The payment id of a token, or nothing if it isn't ours. */
export async function idOf(app: App, token: string): Promise<number | undefined> {
  const id = parseInt(token, 10);
  if (!(id > 0) || !safeEqual(token, await tokenOf(app, id))) return;
  return id;
}

/** Where a provider sends the payer back (`back`) and tells its news (`notify`). */
export async function urls(app: App, id: number): Promise<{ back: string; notify: string }> {
  const base = `${await app.url()}${PATH}/`;
  const token = await tokenOf(app, id);
  return { back: `${base}return/${token}`, notify: `${base}notify/${token}` };
}
