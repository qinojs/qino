/* The node's settings, through the generic settings editor. */
import '@qino/pub/SettingsEditor.mjs';

export default async function (el, { node }) {
  el.head = 'Settings';
  await el.html`<settings-editor source="/api/cms/node/${node.id}/settings"></settings-editor>`;
}
