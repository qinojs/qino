/* Settings widget for the form fields — shipped by this module, mounted by the CMS panel.
  * Content, style and behaviour in one place: no global listeners, no data-node/data-key
  * attributes carrying state through the html, no full reload after every change. */
import { html } from '@qino/pub/html.js';
import { api, t } from '@qino/pub/qino.js';

import { bindSettings } from '../../cms/pub/js/settings.js';

export const css = `
.-fields1 label { display:block; margin-block:.4em; }
.-fields1 .-more input:not([type=checkbox]), .-fields1 .-more textarea { width:100%; }
.-fields1 .-field { padding:.15em 0; }
.-fields1 .-head { display:flex; align-items:center; gap:.2em; }
.-fields1 .-head > input { flex:80 1 auto; }
.-fields1 .-head > button { padding:0 .2em; --size:calc(var(--rem) * 1.4); } /* u2 sizes icons in rem */
.-fields1 .-more { max-height:0; overflow:hidden; box-sizing:border-box;
  transition:max-height .2s linear, padding .2s linear; padding:0 .6em; }
.-fields1 .-field:focus-within .-more { max-height:31em; padding:.6em; }
.-fields1 .-field:focus-within { background-color:#ffffdd; }
.-fields1 .-field[type=flexible] .-more { display:none; }
`;

const TYPES = {
  text: 'Text field', textarea: 'Text block', select: 'Dropdown', checkbox: 'Checkbox',
  radio: 'Radio buttons', email: 'E-Mail', 'email-reply-to': 'E-Mail (sender)', number: 'Number',
  url: 'URL', date: 'Date', time: 'Time', 'datetime-local': 'Local date / time', month: 'Month',
  week: 'Week', range: 'Range', tel: 'Phone', color: 'Color', flexible: 'Mixed content',
};
const POSITIONS = { left: 'Left', top: 'Above', placeholder: 'Inside the field', right: 'Right' };
const AUTOCOMPLETES = ['off', 'name', 'given-name', 'family-name', 'nickname', 'username',
  'new-password', 'current-password', 'organization', 'street-address', 'address-line1',
  'address-level2', 'country-name', 'postal-code', 'bday', 'url', 'tel', 'email'];

const options = (map, current) => Object.entries(map).map(([value, label]) =>
  html`<option value="${value}" ${value === String(current) ? 'selected' : ''}>${label}`);

/** Field ids in their stored order, unknown ones appended. */
const sorted = (inputs, sort) => {
  const ids = Object.keys(inputs ?? {});
  const order = String(sort ?? '').split(',').filter((id) => ids.includes(id));
  return [...order, ...ids.filter((id) => !order.includes(id))];
};

export default async function (el, { node, signal }) {
  const ref = api.cms.node(node.id);
  const [settings, texts] = await Promise.all([
    ref.settings.get({}, { signal }),
    ref.texts.get({ values: true }, { signal }),
    // dynamic: draghandle pulls a cdn dependency that `deno check --all` cannot follow
    import('@qino/u2/attr/dropzone/dropzone.js'),
    import('@qino/u2/attr/draghandle/draghandle.js'),
  ]);
  const { inputs = {}, sort, labelPosition } = settings ?? {};
  const ids = sorted(inputs, sort);
  const txt = (name) => texts?.[name] ?? {};

  el.badge = ids.length;

  const field = (id) => {
    const inp = inputs[id] ?? {};
    const title = txt(id + '_title'), choices = txt(id + '_options'), place = txt(id + '_placeholder');
    return html.async`<div class=-field itemid=${id} type=${inp.type ?? 'text'} tabindex=-1 draggable>
      <div class=-head>
        <select setting="inputs.${id}.type">${options(TYPES, inp.type ?? 'text')}</select>
        <input value="${title.value}" cmstxt=${title.id}>
        <button type=button class="-handle u2-unstyle" u2-draghandle title="${t`Reorder`}"><u2-ico icon=drag1>⠿</u2-ico></button>
        <button type=button class="-remove u2-unstyle" title="${t`Delete`}"><u2-ico icon=delete>✕</u2-ico></button>
      </div>
      <div class=-more>
        <label><input type=checkbox setting="inputs.${id}.required" ${inp.required ? 'checked' : ''}> ${t`Required`}</label>
        ${inp.type === 'email-reply-to' ? html.async`<label><input type=checkbox setting="inputs.${id}.is-recipient" ${inp['is-recipient'] ? 'checked' : ''}> ${t`Send a copy to this address`}</label>` : ''}
        <label>${t`Choices (one per line):`}<textarea cmstxt=${choices.id}>${choices.value}</textarea></label>
        <label>${t`Default value:`}<input setting="inputs.${id}.default" value="${inp.default}"></label>
        <label>${t`Placeholder:`}<input cmstxt=${place.id} value="${place.value}"></label>
        <label>${t`Autocomplete:`}<input list=fields1-ac setting="inputs.${id}.autocomplete" value="${inp.autocomplete}"></label>
      </div>
    </div>`;
  };

  await el.html`<div class=-fields1>
    <label>${t`Label position:`}
      <select setting=labelPosition>${options(POSITIONS, labelPosition ?? 'left')}</select>
    </label>
    <div class=-list u2-dropzone>${ids.map(field)}</div>
    <datalist id=fields1-ac>${AUTOCOMPLETES.map((a) => html`<option value="${a}">`)}</datalist>
    <button type=button class=-add>${t`Add field`}</button>
  </div>`;

  bindSettings(el, ref);
  // the -more block follows the type
  el.on('input', '.-field select[setting]', (sel) => sel.closest('.-field').setAttribute('type', sel.value));

  el.on('click', '.-remove', async (btn) => {
    const f = btn.closest('.-field');
    await ref.settings.inputs[f.getAttribute('itemid')].delete();
    f.remove();
    el.badge = el.querySelectorAll('.-field').length;
  });

  el.on('click', '.-add', async () => {
    await ref.settings.inputs[Date.now().toString(36)].put({ value: {} });
    el.reload();
  });

  /* reorder: u2-dropzone shows an indicator and reorders on drop; the dom order is the new sort */
  el.on('u2-dropzone-drop', '.-list', (list, e) => {
    if (!e.detail?.add) return; // the same zone fires remove+add -> react only once
    requestAnimationFrame(() =>
      ref.settings.sort.put({ value: [...list.children].map((c) => c.getAttribute('itemid')).join(',') }));
  });
}
