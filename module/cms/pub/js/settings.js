/* One meaning for `setting=` across every settings widget: the attribute names the
  * path inside the node's settings, and one listener writes them all. */

/** Bind every `[setting]` field in a widget to `api.cms.node(id).settings`. */
export const bindSettings = (el, ref) => {
  const at = (path) => path.split('.').reduce((r, key) => r[key], ref.settings);
  el.on('input', '[setting]', (inp) =>
    at(inp.getAttribute('setting')).put({ value: inp.type === 'checkbox' ? inp.checked : inp.value }));
};
