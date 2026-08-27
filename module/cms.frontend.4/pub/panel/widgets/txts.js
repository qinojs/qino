/* Every text field of this node, editable in place. */
import { html } from '@qino/pub/html.js';
import { api, t } from '@qino/pub/qino.js';

export const css = `
.-txts { width:100%; }
.-txts .-txt { max-height:1.9em; min-height:1.9em; overflow:auto; padding:.4em; resize:vertical;
  transition:max-height .1s; border:1px solid var(--cms-dark); outline:none; }
.-txts .-txt:hover { max-height:6em; }
.-txts .-txt:focus { max-height:30em; border-color:var(--cms-color); }
`;

export default async function (el, { node, signal }) {
  const texts = await api.cms.node(node.id).texts.get({ values: true }, { signal });

  el.head = t`Texts`;
  el.badge = Object.keys(texts).length;

  await el.html`<table class=-txts>
    ${Object.entries(texts).map(([name, text]) => html`<tr>
      <td>${name}
      <td style="width:70%"><div class=-txt cmstxt=${text.id} contenteditable>${html.raw(text.value)}</div>`)}
  </table>`;
}
