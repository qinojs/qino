/* The modules a user may assign. The list does not change while the page lives, but the settings
  * widget remounts on every node switch — so fetch it once and let both widgets share it.
  * No signal: the request is shared, one widget going away must not cancel it for the other. */
import { api } from '@qino/pub/qino.js';

let list;

export const modules = () => list ??= api.cms.modules.get().catch((err) => {
  list = undefined; // a failed load must not stick
  throw err;
});
