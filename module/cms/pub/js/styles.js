/* CMS chrome styles for a shadow root: --cms-* tokens, buttons, inputs, icon font. */
import { ctx } from '@qino/pub/qino.js';

// Constructed sheets resolve url() against the document, so rebase onto the css file.
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

// serialised, so the cascade follows call order; the fetch starts at once, only the push waits
let pending = Promise.resolve();

/** Adopt a module stylesheet into a shadow root; href is relative to the module dir. */
export const addStyle = (root, href) => {
  const loading = sheet(new URL(ctx.moduleUrl + href, location.href).href);
  return pending = pending.then(async () => root.adoptedStyleSheets.push(await loading));
};

/** Adopt inline css through the same queue, so it keeps its place in the cascade. */
export const addCss = (root, css) => pending = pending.then(() => {
  const s = new CSSStyleSheet();
  s.replaceSync(css);
  root.adoptedStyleSheets.push(s);
});

/** Shared CMS styles. u2 comes from a CDN, so it stays a <link> (fetching would need connect-src).
  * Linked sheets come before adopted ones, so u2 is below ours. */
export const addCmsStyles = (root) => {
  const u2 = ['css/norm/norm.css', 'css/base/base.css', 'class/table/table.css', 'el/ico/ico.css'];
  for (const href of u2.map((p) => '@qino/u2/' + p)) {
    root.append(Object.assign(document.createElement('link'), { rel: 'stylesheet', href: import.meta.resolve(href) }));
  }
  return addStyle(root, 'cms/pub/css/ui.css');
};
