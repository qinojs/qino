/* The node's settings, through the generic settings editor. */
import '@qino/pub/SettingsEditor.mjs';

export default async function (widget, { node }) {
  widget.head = 'Settings';
  await widget.html`<settings-editor source="/api/cms/node/${node.id}/settings"></settings-editor>`;
}
