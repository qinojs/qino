/* Panel widget for the fields. A field is added by its label — the name it is stored under
   follows from it and never changes again, so the entries keep their meaning. */
import { html } from '@qino/pub/html.js';
import { api } from '@qino/pub/api.js';
import { t } from '@qino/pub/t.js';

import { bindSettings } from '../../cms/pub/js/settings.js';

export const css = `
.-fields4 {
  .-list { display:flex; flex-direction:column; gap:.2em; }

  .-field { border:1px solid var(--cms-light); }
  .-field[open] { background-color:#ffffdd; }

  .-head {
    display:flex; align-items:center; gap:.2em;
    padding:.4em;
    > select { flex:0 1 auto; }
    /* the name identifies the row now that the label sits in the details */
    > .-name { flex:1 1 auto; min-width:calc(var(--rem) * 3); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    /* u2 sizes icons in rem — pin them to our own anchor, the way the other widgets do */
    > button { flex:0 0 auto; padding:0 .2em; --size:calc(var(--rem) * 1.4); }
    > .-handle { cursor:n-resize; }
  }

  /* The details fold out under the head; the arrow turns with them. */
  .-more { max-height:0; overflow:hidden; box-sizing:border-box;
    transition:max-height .2s linear, padding .2s linear; padding:0 .6em; }
  .-field[open] .-more { max-height:31em; padding:.6em; }
  .-field[open] .-toggle u2-ico { rotate:180deg; }

  .-more label { display:block; margin-block:.4em; }
  .-more input:not([type=checkbox]), .-more textarea, .-more select { width:100%; }
  .-more .-remove { margin-top:.6em; }
}
`;

const TYPES = ['text', 'textarea', 'email', 'number', 'date', 'tel', 'url', 'checkbox', 'select', 'radio', 'file'];

const options = (list, active) => list.map((value) =>
  html`<option ${value === String(active) ? 'selected' : ''}>${value}`);

export default async function (widget, { node, dialogs, signal }) {
  const ref = api.cms.node(node.id);
  const [settings, texts] = await Promise.all([
    ref.settings.get({}, { signal }),
    ref.texts.get({ values: true }, { signal }),
    // dynamic: the drag attributes pull a cdn dependency that `deno check --all` cannot follow
    import('@qino/u2/attr/dropzone/dropzone.js'),
    import('@qino/u2/attr/draghandle/draghandle.js'),
    import('@qino/u2/attr/disableif/disableif.js'),
  ]);
  const fields = settings.fields ?? {}; // a form that has no field yet has none

  const all = Object.keys(fields);
  const order = String(settings.sort ?? '').split(',').filter((n) => all.includes(n));
  const names = [...order, ...all.filter((n) => !order.includes(n))];
  widget.badge = names.length;

  const txt = (name) => texts[name] ?? { id: '', value: '' };
  /* The condition of one field names the others — offer them, the operators are typed. */
  const others = (self) => names.filter((n) => n !== self);

  /* Every field is its own form: u2-disableif reads its condition through `el.form`, so the
     type select carries a name and the names have to stay unique. Nothing is submitted here,
     the bindings save each change on their own. */
  const field = (name) => {
    const set = fields[name] ?? {};
    const title = txt(name + '_title'), choices = txt(name + '_options'), place = txt(name + '_placeholder');
    return html.async`<form class=-field itemid=${name} draggable>
      <div class=-head>
        <button type=button class="u2-unstyle -handle" u2-draghandle title="${t`Reorder`}"><u2-ico icon=drag_indicator>⠿</u2-ico></button>
        <code class=-name title="${t`Field name`}">${name}</code>
        <select name=type setting="fields.${name}.type">${options(TYPES, set.type ?? 'text')}</select>
        <button type=button class="u2-unstyle -toggle" aria-expanded=false title="${t`Details`}"><u2-ico icon=expand_more>▾</u2-ico></button>
      </div>
      <div class=-more>
        <label>${t`Label:`}<input value="${title.value}" cmstxt=${title.id}></label>
        <label><input type=checkbox setting="fields.${name}.required" ${set.required ? 'checked' : ''}> ${t`Required`}</label>
        <label><input type=checkbox u2-disableif="type!=email" setting="fields.${name}.is-recipient" ${set['is-recipient'] ? 'checked' : ''}> ${t`Send a copy to this address`}</label>
        <label>${t`Choices (one per line):`}<textarea u2-disableif="type=checkbox" cmstxt=${choices.id}>${choices.value}</textarea></label>
        <label>${t`Default value:`}<input u2-disableif="type=file" setting="fields.${name}.default" value="${set.default ?? ''}"></label>
        <label>${t`Placeholder:`}<input u2-disableif="type=checkbox" cmstxt=${place.id} value="${place.value}"></label>
        <label>${t`Disable if:`}<input setting="fields.${name}.disableif" value="${set.disableif ?? ''}" placeholder="${others(name)[0] ? others(name)[0] + '=yes' : 'field=value'}" list=fields4-names></label>
        <button type=button class="-remove u2-button" u2-confirm="${t`Delete field?`}">${t`Delete field`}</button>
      </div>
    </form>`;
  };

  await widget.html`<div class=-fields4>
    <div class=-list u2-dropzone style="padding-bottom:.5rem">${names.map(field)}</div>
    <datalist id=fields4-names>${names.map((n) => html`<option value="${n}">`)}</datalist>
    <button type=button class="-add">${t`Add field`}</button>
  </div>`;

  bindSettings(widget, ref);
  // A field block is a form only for u2-disableif — Enter must not navigate away.
  widget.on('submit', (el, e) => e.preventDefault());

  widget.on('click', '.-toggle', (btn) => {
    const open = btn.closest('.-field').toggleAttribute('open');
    btn.setAttribute('aria-expanded', open);
  });

  /* Both go to the module's own api: it owns the rule that turns a label into a name, and
     it takes the field's texts with it when the field goes. */
  widget.on('click', '.-remove', async (btn) => {
    const f = btn.closest('.-field');
    await ref.api.post({ remove: f.getAttribute('itemid') });
    f.remove();
    widget.badge = widget.querySelectorAll('.-field').length;
  });

  widget.on('click', '.-add', async () => {
    const label = await dialogs.prompt(t`Label:`, '');
    if (!label) return;
    const res = await ref.api.post({ add: label });
    if (res?.error) return dialogs.alert(res.error);
    widget.reload();
  });

  /* reorder: u2-dropzone shows an indicator and reorders on drop; the dom order is the new sort */
  widget.on('u2-dropzone-drop', '.-list', (list, e) => {
    if (!e.detail?.add) return; // the same zone fires remove+add -> react only once
    requestAnimationFrame(() =>
      ref.settings.sort.put({ value: [...list.children].map((c) => c.getAttribute('itemid')).join(',') }));
  });
}
