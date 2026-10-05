/* Panel widget: the template files of this layout, opened in the file editor. */
import { html } from '@qino/pub/html.js';
import { api } from '@qino/pub/api.js';
import { t } from '@qino/pub/t.js';

export const css = `.-layoutFiles a { display:block; }`;

export default async function (widget, { node, signal }) {
  const files = await api.cms.node(node.id).api.post({ do: 'getFileEditorLinks' }, { signal }) ?? [];
  if (!files.length) return; // no editor, or the layout page is not this user's to edit

  await widget.html`<div class=-layoutFiles>
    <p>${t`Edit the files of this layout:`}</p>
    ${files.map((f) => html`<a data-key="${f.key}" target=_blank href="${f.url}">${f.name}</a>`)}
  </div>`;
  // A missing file gets its starting point first; the tab opens synchronously so no popup blocker interferes.
  widget.on('click', '.-layoutFiles a', async (link, event) => {
    event.preventDefault();
    const tab = globalThis.open('about:blank', '_blank');
    try {
      await api.cms.node(node.id).api.post({ do: 'openFile', key: link.dataset.key }, { signal });
      if (tab) tab.location.href = link.href;
    } catch (error) {
      tab?.close();
      throw error;
    }
  });
}
