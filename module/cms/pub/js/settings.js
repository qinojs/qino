/* `setting=` in settings widgets: the path in the node's settings; one listener saves all. */

/** Bind every `[setting]` field in a widget to `api.cms.node(id).settings`. */
export const bindSettings = (el, ref) => {
  const at = (path) => path.split('.').reduce((r, key) => r[key], ref.settings);
  el.on('input', '[setting]', (inp) =>
    at(inp.getAttribute('setting')).put({ value: inp.type === 'checkbox' ? inp.checked : inp.value }));
};
