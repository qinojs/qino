/* Panel widget: the u2 release of this layout and its template files, opened in the file editor. */
import { html } from '@qino/pub/html.js';
import { api } from '@qino/pub/api.js';
import { t } from '@qino/pub/t.js';

import { bindSettings } from '../../cms/pub/js/settings.js';

export const css = `.-layoutFiles a { display:block; }`;

export default async function (widget, { node, signal }) {
  // the global layout page: its u2 release and files; nothing for who may not write it
  const layout = await api.cms.node(node.id).api.post({ do: 'getLayout' }, { signal });
  if (!layout) return;

  await widget.html`<div class=-layoutFiles>
    <label>${t`u2 release`}
      <input setting=u2Version value="${layout.u2Version}" placeholder="${layout.u2Default}" pattern="\\d+\\.\\d+\\.\\d+">
    </label>
    ${layout.files.length ? html`<p>${t`Edit the files of this layout:`}</p>` : ''}
    ${layout.files.map((f) => html`<a data-key="${f.key}" target=_blank href="${f.url}">${f.name}</a>`)}
  </div>`;
  bindSettings(widget, api.cms.node(layout.id)); // saved on the layout page, for every page using it

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
