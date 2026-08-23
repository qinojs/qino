/* CMS chrome styles for a shadow root: --cms-* tokens, buttons, inputs, icon font. */
import { ctx } from '@qino/pub/qino.js';

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

// serialised, so the cascade follows call order
let pending = Promise.resolve();

/** Adopt a module stylesheet into a shadow root; href is relative to the module dir. */
export const addStyle = (root, href) =>
  pending = pending.then(async () => root.adoptedStyleSheets.push(await sheet(new URL(ctx.moduleUrl + href, location.href).href)));

/** Adopt inline css through the same queue, so it keeps its place in the cascade. */
export const addCss = (root, css) => pending = pending.then(() => {
  const s = new CSSStyleSheet();
  s.replaceSync(css);
  root.adoptedStyleSheets.push(s);
});

/** The shared CMS look. u2 ships from a CDN — fetching it would need connect-src for that
  * origin, so it stays a link. Tree sheets cascade before adopted ones, keeping u2 below ours. */
export const addCmsStyles = (root) => {
  for (const href of ['@qino/u2/css/norm/norm.css', '@qino/u2/css/base/base.css']) {
    root.append(Object.assign(document.createElement('link'), { rel: 'stylesheet', href: import.meta.resolve(href) }));
  }
  return addStyle(root, 'cms/pub/css/ui.css');
};
