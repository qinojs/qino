/* Modules the user may assign. Fetched once per page and shared by both widgets (the settings
  * widget remounts on every node switch). No signal: one widget must not cancel it for the other. */
import { api } from '@qino/pub/api.js';

let list;

export const modules = () => list ??= api.cms.modules.get().catch((err) => {
  list = undefined; // a failed load must not stick
  throw err;
});

/** Display name: content and layout modules without their prefix ("cms.cont.text" → "Text",
 *  "cms.layout.deck.1" → "Deck 1"), any other module just without "cms." ("backend.cms"). */
export const label = (name) => {
  if (!/^cms\.(cont|layout)\./.test(name)) return name.replace(/^cms\./, '');
  const short = name.replace(/^cms\.(cont|layout)\./, '').replace(/\./g, ' ');
  return short.charAt(0).toUpperCase() + short.slice(1);
};
