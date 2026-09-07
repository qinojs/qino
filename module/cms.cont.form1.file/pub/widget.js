/* Settings widget for the file field — shipped by this module, mounted by the CMS panel.
  * Content, style and behaviour in one place; no global listener piercing the shadow root. */
import { html } from '@qino/pub/html.js';
import { api } from '@qino/pub/api.js';
import { t } from '@qino/pub/t.js';

import { bindSettings } from '../../cms/pub/js/settings.js';

export const css = `
.-fileSettings label { display:block; margin-block:.6em; }
.-fileSettings textarea { width:100%; }
.-fileSettings td { padding:.3em .6em .3em 0; vertical-align:top; }
.-fileSettings td:first-child { white-space:nowrap; }
`;

const EXAMPLES = [
  ['All images', 'image/*'],
  ['Only JPEG', 'image/jpeg'],
  ['PDF', 'application/pdf'],
  ['PDF and Word', 'application/pdf, application/msword, application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
];

const types = (accept) => String(accept ?? '').split(',').filter((v) => v.trim()).length;

export default async function (el, { node, signal }) {
  const ref = api.cms.node(node.id);
  const { accept, required, multiple } = await ref.settings.get({}, { signal }) ?? {};

  el.badge = types(accept);

  // `setting=` names the key each field writes — one binding below covers all of them.
  await el.html`<div class=-fileSettings>
    <label>
      ${t`Accepted file types:`}
      <textarea setting=accept rows=3>${accept}</textarea>
    </label>
    <label><input type=checkbox setting=required ${required ? 'checked' : ''}> ${t`Required`}</label>
    <label><input type=checkbox setting=multiple ${multiple ? 'checked' : ''}> ${t`Allow multiple files`}</label>
    <p><b>${t`Examples:`}</b></p>
    <table>${EXAMPLES.map(([label, value]) => html`<tr><td>${label}<td>${value}`)}</table>
  </div>`;

  bindSettings(el, ref);
  el.on('input', '[setting=accept]', (inp) => el.badge = types(inp.value));
}
