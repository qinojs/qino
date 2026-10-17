import setup from '../../cms.layout.houdini/pub/widget.js';

export { css } from '../../cms.layout.houdini/pub/widget.js';

export default async function (widget, options) {
  const cleanup = await setup(widget, options);
  widget.head = 'Houdini 2';
  return cleanup;
}
