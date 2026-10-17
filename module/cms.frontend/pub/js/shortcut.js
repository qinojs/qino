/* Page-level shortcuts: plain keys, and only while the page itself has focus. */

/** Skips keys owned by a CMS component (shadow DOM) or by an input in the page content. */
export const onShortcut = (fn) => document.addEventListener('keydown', (e) => {
  const target = e.composedPath()[0]; // real element even inside shadow DOM (e.target would be the host)
  if (target.getRootNode() !== document) return;
  if (target.isContentEditable || target.form !== undefined) return;
  if (e.shiftKey || e.metaKey || e.altKey || e.ctrlKey) return;
  fn(e.key, e);
});
