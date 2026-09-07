/* Panel widget of a layout module: the template files of the whole site, in the file editor.
   Shared by the layout modules — they re-export it, so it stays one file. */
import { html } from '@qino/pub/html.js';
import { api } from '@qino/pub/api.js';
import { t } from '@qino/pub/t.js';

export const css = `.-layoutFiles a { display:block; }`;

export default async function (widget, { node, signal }) {
  const files = await api['cms.templateParser'].node(node.id).editors.get({}, { signal }).catch(() => []);
  if (!files.length) return; // no editor, or the layout page is not this user's to edit

  await widget.html`<div class=-layoutFiles>
    <p>${t`Edit the files of this layout:`}</p>
    ${files.map((f) => html`<a target=_blank href="${f.url}">${f.name}</a>`)}
  </div>`;
}
