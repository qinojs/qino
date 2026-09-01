/* The files behind a node's module: what the site added next to what the module ships,
  * plus the module's app settings. */
import '@qino/pub/SettingsEditor.mjs';
import { html } from '@qino/pub/html.js';
import { api } from '@qino/pub/api.js';
import { t } from '@qino/pub/t.js';

export const css = `
.-files { display:flex; flex-flow:wrap; margin:-.125rem; }
.-files > [scope] { margin:.125rem; flex:1 1 auto; }
.-files table { width:100%; }
.-files .-create { width:100%; }
.-files .-remove { cursor:pointer; padding-left:0; }
`;

const SCOPES = [['data', 'Custom Files'], ['app', 'App Files']];

export default async function (widget, { node, dialogs, signal }) {
  const ref = api['cms.frontend.4'].files(node.id);
  const list = await ref.get({}, { signal });

  widget.head = t`Superuser`;

  const row = (file) => html`<tr itemid="${file.path}">
    <td>${file.editor ? html`<a href="${file.editor}" target="${encodeURIComponent(file.path)}">${file.name}</a>` : file.name}
    <td>${new Date(file.mtime).toLocaleDateString()}
    <td class=-remove><u2-ico inline icon=delete>✕</u2-ico>`;

  await widget.html`<div class=-files>
    ${SCOPES.map(([scope, title]) => html`<div scope="${scope}">
      <div class="-widgetHead -open"><span class=-title>${title}</span></div>
      <div class=-content>
        <table class=-styled>
          <tr><th colspan=3><input class=-create placeholder=create>
          ${list[scope].map(row)}
        </table>
      </div>
    </div>`)}
  </div>
  ${list.settings
    ? html`<div class="-widgetHead -open"><span class=-title>Global Settings</span></div>
      <div class=-content><settings-editor source="/api/core/settings/${list.settings}"></settings-editor></div>`
    : ''}`;

  const scopeOf = (inner) => inner.closest('[scope]').getAttribute('scope');
  widget.on('keyup', '.-create', (inp, e) => {
    if (e.key !== 'Enter' || !inp.value) return;
    ref.post({ in: scopeOf(inp), path: inp.value }).then(() => widget.reload());
  });
  widget.on('click', '.-remove', async (td) => {
    if (!await dialogs.confirm(t`Really delete this file?`)) return;
    await ref.delete({ in: scopeOf(td), path: td.closest('tr').getAttribute('itemid') });
    widget.reload();
  });
}
