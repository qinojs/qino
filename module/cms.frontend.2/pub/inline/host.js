/* Slots a host UI (the panel) registers into. Inline calls through here and runs without a host. */
import { scope } from '@qino/u2/js/dialog/dialog.js';
import { cms } from '../../../cms/pub/js/cms.mjs';

export const host = {};

/** Select a content and let the host open its settings. Callers hide their affordance while
  * `host.showSettings` is unset — without a host there is nowhere to show them. */
export const showSettings = pid => {
  if (!host.showSettings) return;
  cms.cont.active = pid;
  host.showSettings(pid);
};

/** Page-level handlers (content marking, context menu) must not see clicks inside a dialog. */
export const isolateDialog = el => ['click', 'mousedown', 'touchstart'].forEach(type =>
  el.addEventListener(type, e => e.stopPropagation()));

/** t`` returns a thenable -> await the text, else u2 treats the promise as the options object. */
export const useDialogs = scoped => cms.dialogs = {
  ...scoped,
  alert:   async (text)          => scoped.alert(await text),
  confirm: async (text)          => scoped.confirm(await text),
  prompt:  async (text, initial) => scoped.prompt(await text, initial),
};

useDialogs(scope({ init: isolateDialog })); // document-level; the panel re-registers scoped to its shadow root
