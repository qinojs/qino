/* The one shadow root all CMS chrome lives in: panel, inline overlays, dialogs.
  * Page markup stays in the document — it is styled by inline/page.css, never from here. */
import { ctx } from '@qino/pub/qino.js';

customElements.define('qino-cms', class extends HTMLElement {
  connectedCallback() {
    if (this.shadowRoot) return;
    const shadow = this.attachShadow({ mode: 'open' });
    while (this.firstChild) shadow.append(this.firstChild); // server-rendered panel markup
  }
});

export const root = (document.querySelector('qino-cms') ?? document.body.appendChild(document.createElement('qino-cms'))).shadowRoot;

// A constructed sheet resolves url() against the document, so rebase it onto the css file.
const rebase = (css, base) =>
  css.replace(/url\((["']?)(?!data:|https?:|\/)([^"')]+)\1\)/g, (_, _q, path) => `url("${new URL(path, base)}")`);

const sheets = new Map();
const sheet = (href) => {
  if (!sheets.has(href)) {
    sheets.set(href, fetch(href).then((r) => r.text()).then((css) => {
      const s = new CSSStyleSheet();
      s.replaceSync(rebase(css, href));
      return s;
    }));
  }
  return sheets.get(href);
};

// moduleUrl is root-relative; rebase() needs an absolute base
const url = (href) => new URL(ctx.moduleUrl + href, location.href).href;

// serialised, so the cascade follows call order
let pending = Promise.resolve();
/** Each layer adopts its own stylesheet; the base below is shared. */
export const addStyle = (href) =>
  pending = pending.then(async () => root.adoptedStyleSheets.push(await sheet(url(href))));

// u2 ships from a CDN — fetching it would need connect-src for that origin, so it stays a link.
// Tree stylesheets cascade before adopted ones, which keeps u2's base below ours.
for (const href of ['@qino/u2/css/norm/norm.css', '@qino/u2/css/base/base.css']) {
  root.append(Object.assign(document.createElement('link'), { rel: 'stylesheet', href: import.meta.resolve(href) }));
}
addStyle('cms/pub/css/ui.css');
addStyle('cms.frontend.2/pub/css/off.css').then(() => root.host.hidden = false);
