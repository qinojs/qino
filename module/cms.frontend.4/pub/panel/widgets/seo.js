/* SEO widget: title, description and crawl priority of a node. */
import { api, t } from '@qino/pub/qino.js';

import { bindSettings } from '../../../../cms/pub/js/settings.js';

export const css = `
.-seo :invalid, .-seo .-invalid.-invalid { border-bottom-color:var(--cms-access-3); }
.-seo input, .-seo textarea { display:block; width:100%; }
.-seo textarea { height:calc(var(--rem) * 2.8125); }
`;

export default async function (widget, { node, signal }) {
  const ref = api.cms.node(node.id);
  const [texts, settings] = await Promise.all([
    ref.texts.get({ values: true }, { signal }),   // ids + values in one request
    ref.settings.get({}, { signal }),
  ]);
  const title = texts?._title ?? {}, descr = texts?._meta_description ?? {};

  widget.head = t`SEO`;
  widget.badge = descr.value?.trim() ? '' : '!'; // same data as the body — no second round-trip

  await widget.html`<div class=-seo>
    ${t`Title`}:
    <input cmstxt=${title.id} value="${title.value}" required pattern=".{10,55}" maxlength=100
           placeholder="${t`max. 55 characters`}">
    ${t`Description`}:
    <textarea class=-desc cmstxt=${descr.id} required pattern=".{60,156}" maxlength=220
              placeholder="${t`max. 156 characters`}" rows=4>${descr.value}</textarea>
    ${t`The priority of this page relative to other pages on your website.`}:
    <input type=range min=0 max=1 step=.1 value=${settings?._seo_priority ?? 0.5} setting=_seo_priority>
  </div>`;

  bindSettings(widget, ref);
  const check = (d) => d.classList.toggle('-invalid', !/^.{60,156}$/.test(d.value));
  widget.on('input', '.-desc', (d) => { check(d); widget.badge = d.value.trim() ? '' : '!'; });
  check(widget.querySelector('.-desc'));
}
