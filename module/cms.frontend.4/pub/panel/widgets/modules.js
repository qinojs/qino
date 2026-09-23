/* Modules the user may assign. Fetched once per page and shared by both widgets (the settings
  * widget remounts on every node switch). No signal: one widget must not cancel it for the other. */
import { api } from '@qino/pub/api.js';

let list;

export const modules = () => list ??= api.cms.modules.get().catch((err) => {
  list = undefined; // a failed load must not stick
  throw err;
});
