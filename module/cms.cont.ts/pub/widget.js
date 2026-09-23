/* Panel widget: the node's ts/css/js in the file editor. Superusers only (others get nothing). */
import { html } from '@qino/pub/html.js';
import { api } from '@qino/pub/api.js';
import { t } from '@qino/pub/t.js';

export const css = `.-codeFiles a { display:block; }`;

export default async function (widget, { node, signal }) {
  const files = await api.cms.node(node.id).api.post({ do: 'getFileEditorLinks' }, { signal }) ?? [];
  if (!files.length) return;

  await widget.html`<div class=-codeFiles>
    <p>${t`Edit the files of this content:`}</p>
    ${files.map((f) => html`<a target=_blank href="${f.url}">${f.name}</a>`)}
  </div>`;
}
