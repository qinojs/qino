/* CMS dialogs, scoped to the CMS root so they get the CMS styles wherever they are opened from. */
import { scope } from '@qino/u2/js/dialog/dialog.js';

import { root } from './root.js';

// Page-level handlers (content marking, context menu) must not see clicks inside a dialog.
const isolate = el => ['click', 'mousedown', 'touchstart'].forEach(type =>
  el.addEventListener(type, e => e.stopPropagation()));

const scoped = scope({ root, init: isolate });

// t`` returns a thenable -> await the text, else u2 treats the promise as the options object.
export const dialogs = {
  ...scoped,
  alert:   async (text)          => scoped.alert(await text),
  confirm: async (text)          => scoped.confirm(await text),
  prompt:  async (text, initial) => scoped.prompt(await text, initial),
};
