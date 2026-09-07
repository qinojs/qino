/* Panel widget: the node's own ts/css/js, opened in the file editor. Superuser only —
   the endpoint answers with nothing for everyone else. */
import { html } from '@qino/pub/html.js';
import { api } from '@qino/pub/api.js';
import { t } from '@qino/pub/t.js';

export const css = `.-codeFiles a { display:block; }`;

export default async function (widget, { node, signal }) {
  const files = await api['cms.cont.ts'].node(node.id).editors.get({}, { signal }).catch(() => []);
  if (!files.length) return;

  await widget.html`<div class=-codeFiles>
    <p>${t`Edit the files of this content:`}</p>
    ${files.map((f) => html`<a target=_blank href="${f.url}">${f.name}</a>`)}
  </div>`;
}
