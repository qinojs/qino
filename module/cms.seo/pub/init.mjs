/* Share fields in the panel's SEO widget: title, description and image for shared links. */
import { api } from '@qino/pub/api.js';
import { html, unhee } from '@qino/pub/html.js';
import { t } from '@qino/pub/t.js';
import { SelectorObserver } from '@qino/u2/js/SelectorObserver/SelectorObserver.js';

import { cms } from '../../cms/pub/js/cms.mjs';

const NAMES = '_title,_description,_share_title,_share_description';

async function render(part, id) {
  const ref = api.cms.node(id);
  const [texts, files] = await Promise.all([
    ref.texts.get({ values: true, names: NAMES }), // creates the share texts, so they have ids
    ref.files.get({ thumb: '280x150' }),
  ]);
  const { _title: title, _description: descr, _share_title: shareTitle, _share_description: shareDescr } = texts;
  const file = files?.share?.placeholder ? null : files?.share;
  part.innerHTML = await html.async`
    ${t`Share title`}:
    <input cmstxt=${shareTitle.id} value="${unhee(shareTitle.value)}" placeholder="${unhee(title.value)}">
    ${t`Share description`}:
    <textarea cmstxt=${shareDescr.id} rows=3 placeholder="${unhee(descr.value)}">${shareDescr.value}</textarea>
    ${t`Share image`}:
    <div>
      ${file ? html`<img src="${file.thumb}" alt="" style="display:block; max-width:100%">` : ''}
      <button type=button class=-pick>${file ? t`replace` : t`choose`}</button>
      ${file ? html.async`<button type=button class=-remove>${t`delete`}</button>` : ''}
    </div>`;
  const reload = () => render(part, id);
  part.querySelector('.-pick').onclick = () => {
    // cms.filebrowser offers its file library
    if (cms.replaceFile) return cms.replaceFile(id, 'share');
    const inp = Object.assign(document.createElement('input'), { type: 'file', accept: 'image/*' });
    inp.onchange = () => inp.files[0] && cms.cont(id).upload(inp.files[0], reload, 'share');
    inp.click();
  };
  const remove = part.querySelector('.-remove');
  if (remove) remove.onclick = async () => {
    if (await cms.dialogs.confirm(await t`Really delete this file?`)) ref.file('share').delete().then(reload);
  };
}

customElements.whenDefined('qino-cms').then(() => {
  const root = document.querySelector('qino-cms')?.shadowRoot;
  if (!root) return;
  // the SEO widget shows the active page, as the panel's settings do
  new SelectorObserver({ on: (seo) => {
    const part = document.createElement('div');
    seo.append(part);
    render(part, cms.cont.active || globalThis.qino.cms.nodeId);
  } }).observe('.-seo', { root });
});
