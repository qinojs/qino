/* The one shadow root all CMS chrome lives in: panel, inline overlays, dialogs.
  * Page markup stays in the document — it is styled by inline/page.css, never from here.
  * Dialogs hang on the root itself: root.alert(), root.confirm(), root.modal().
  *
  * u2 runs scoped in here: its own registry, its own version. Whatever the customer page
  * loads stays out, and u2-elements in the panel resolve against ours. */
import { scope } from '@qino/u2/js/dialog/dialog.js';
import { attachShadow } from '@qino/u2/u2/enhance.js';

import { addStyle } from '../../../cms/pub/js/styles.js';

customElements.define('qino-cms', class extends HTMLElement {
  connectedCallback() {
    if (this.shadowRoot) return;
    // enhance() watches from here on: u2-elements in the markup below load and register themselves
    const shadow = attachShadow(this, { mode: 'open' });
    while (this.firstChild) shadow.append(this.firstChild); // server-rendered panel markup
  }
  /** Anything mounting into the CMS root adds its stylesheet through here. */
  addStyle(href) { return addStyle(this.shadowRoot, href); }
});

export const root = (document.querySelector('qino-cms') ?? document.body.appendChild(document.createElement('qino-cms'))).shadowRoot;


// norm.css and base.css come with enhance(); this is the cms layer on top
addStyle(root, 'cms/pub/css/ui.css');
root.host.addStyle('cms.frontend.4/pub/css/off.css').then(() => root.host.hidden = false);

// Page-level handlers (content marking, context menu) must not see clicks inside a dialog.
const isolate = (el) => ['click', 'mousedown', 'touchstart'].forEach((type) =>
  el.addEventListener(type, (e) => e.stopPropagation()));

const scoped = scope({ root, init: isolate });

// t`` returns a thenable -> await the text, else u2 treats the promise as the options object.
Object.assign(root, scoped, {
  alert:   async (text)          => scoped.alert(await text),
  confirm: async (text)          => scoped.confirm(await text),
  prompt:  async (text, initial) => scoped.prompt(await text, initial),
});
