/* The shadow root for all CMS UI: panel, inline overlays, dialogs. Page markup stays in the
  * document (styled by inline/page.css). Dialogs: root.alert(), root.confirm(), root.modal().
  *
  * u2 runs scoped here with its own registry and version, independent of the page's u2. */
import { scope } from '@qino/u2/js/dialog/dialog.js';
import { attachShadow } from '@qino/u2/u2/enhance.js';

import { ctx } from '@qino/pub/qino.js';

customElements.define('qino-cms', class extends HTMLElement {
  connectedCallback() {
    if (this.shadowRoot) return;
    // enhance() from here on loads and registers u2 elements in the markup below
    const shadow = attachShadow(this, { mode: 'open' });
    while (this.firstChild) shadow.append(this.firstChild); // server-rendered panel markup
  }
  /** Anything mounting into the CMS root adds its stylesheet through here. */
  addStyle(href) { return addStyle(href); }
});

export const root = (document.querySelector('qino-cms') ?? document.body.appendChild(document.createElement('qino-cms'))).shadowRoot;

// Page-level handlers (content marking, context menu) must not see clicks inside a dialog.
const isolate = (el) => ['click', 'mousedown', 'touchstart'].forEach((type) =>
  el.addEventListener(type, (e) => e.stopPropagation()));

const scoped = scope({ root, init: isolate });

// t`` returns a thenable -> await it, else u2 takes the promise as options object.
Object.assign(root, scoped, {
  alert:   async (text)          => scoped.alert(await text),
  confirm: async (text)          => scoped.confirm(await text),
  prompt:  async (text, initial) => scoped.prompt(await text, initial),
});

/* ─── styles: module css adopted into the root ─────────────────────────────── */

// Constructed sheets resolve url() against the document, so rebase onto the css file.
const rebase = (css, base) =>
  css.replace(/url\((["']?)(?!data:|https?:|\/)([^"')]+)\1\)/g, (_, _q, path) => `url("${new URL(path, base)}")`);

// serialised, so the cascade follows call order; the fetch starts at once, only the push waits
let pending = Promise.resolve();

/** Adopt a module stylesheet into the root; href is relative to the module dir. */
function addStyle(href) {
  const url = new URL(ctx.moduleUrl + href, location.href).href;
  const loading = fetch(url).then((r) => r.text()).then((css) => {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(rebase(css, url));
    return sheet;
  });
  return pending = pending.then(async () => root.adoptedStyleSheets.push(await loading));
}

// norm.css and base.css come with enhance(); this adds the cms styles
addStyle('cms/pub/css/ui.css');
addStyle('cms.frontend.4/pub/css/off.css').then(() => root.host.hidden = false);
