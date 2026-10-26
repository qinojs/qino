/* Panel widget: the table, its columns — along references into other tables too —, what each field
   allows, the list's options and the SQL it makes. Each change saves itself. */
import { html, unhee } from '@qino/pub/html.js';
import { api } from '@qino/pub/api.js';
import { t } from '@qino/pub/t.js';

import { bindSettings } from '../../cms/pub/js/settings.js';

export const css = `
.-dbtable {
  details { margin-block:.6em; }
  summary { cursor:pointer; font-weight:bold; }
  label { display:block; margin-block:.3em; }
  :is(input:not([type=checkbox]), select, textarea) { width:100%; box-sizing:border-box; }

  .-tree ul { list-style:none; margin:0; padding-left:1.2em; }
  .-tree > ul { padding-left:0; }
  .-tree li > label { display:inline; }
  .-tree .-open { padding:0 .2em; cursor:pointer; }
  .-tree .-type { color:#999; font-size:.85em; }

  .-list { display:flex; flex-direction:column; gap:.2em; }
  .-field { border:1px solid var(--cms-light); }
  .-field > .-head { display:flex; align-items:center; gap:.3em; padding:.3em;
    > .-name { flex:1 1 auto; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; cursor:pointer; }
    > select { flex:0 1 7em; width:auto; }
    > button { flex:0 0 auto; padding:0 .2em; --size:calc(var(--rem) * 1.4); }
    > .-handle { cursor:n-resize; }
  }
  .-flags { display:flex; flex-wrap:wrap; gap:0 .8em; padding:0 .4em .4em;
    label { display:inline-flex; gap:.2em; margin:0; } }
  .-more { display:none; padding:.4em .6em .8em; }
  .-field[open] .-more { display:block; }
  .-field[open] .-toggle u2-ico { rotate:180deg; }
  /* only what the chosen type uses */
  .-field:not(:has([name=type] :checked[value=select])) .-choices,
  .-field:not(:has([name=type] :checked[value=reference])) .-ref,
  .-field:not(:has([name=type] :checked[value=image])) .-size,
  .-field:not(:has([name=type] :checked[value=textarea])) .-cut { display:none; }
  .-sql { white-space:pre-wrap; word-break:break-all; font-size:.85em; }
}
`;

export default async function (widget, { node, dialogs, signal }) {
  const ref = api.cms.node(node.id);
  const call = (vars) => ref.api.post(vars);
  const lang = document.documentElement.lang;
  const [settings, texts, { tables, types }] = await Promise.all([
    ref.settings.get({}, { signal }),
    ref.texts.get({ values: true, lang }, { signal }),
    call({ do: 'tables' }),
    import('@qino/u2/attr/dropzone/dropzone.js'),
    import('@qino/u2/attr/draghandle/draghandle.js'),
  ]);
  const fields = settings.fields ?? {};
  const all = Object.keys(fields);
  const order = String(settings.field_order ?? '').split(',').filter((n) => all.includes(n));
  const names = [...order, ...all.filter((n) => !order.includes(n))];
  const pathOf = (name) => fields[name]?.path || name;
  widget.badge = names.length;

  const FLAGS = [
    ['edit', t`Edit`], ['insert', t`New`],
    ['search', t`Search`], ['sort', t`Sort`], ['filter', t`Filter`], ['fix', t`Fixed`],
  ];
  const checked = (v) => v === true || v === 1 || v === '1' ? 'checked' : '';
  const txt = (name) => texts[name] ?? { id: '', value: '' };
  const option = (value, active, label = value) => html.async`<option value="${value}" ${value === String(active ?? '') ? 'selected' : ''}>${label}`;

  /* the columns of a table; a reference opens the columns of the row it points to */
  const columns = async (table, prefix) => {
    const { columns = [] } = await call({ do: 'columns', table });
    return html.async`<ul>${columns.map((c) => {
      const path = prefix + c.name;
      const used = names.some((n) => pathOf(n) === path);
      return html`<li data-path="${path}">
        ${c.parent ? html`<span class=-open data-table="${c.parent}" title="${c.parent}">▸</span>` : ''}
        <label><input type=checkbox class=-use ${used ? 'checked' : ''}> ${c.name}</label>
        <span class=-type>${c.type}${c.primary ? ' · key' : ''}${c.parent ? ' → ' + c.parent : ''}</span>`;
    })}</ul>`;
  };

  const field = (name) => {
    const set = fields[name] ?? {}, title = txt(name + '_title');
    return html.async`<div class=-field itemid=${name} draggable>
      <div class=-head>
        <button type=button class="u2-unstyle -handle" u2-draghandle title="${t`Reorder`}"><u2-ico icon=drag_indicator>⠿</u2-ico></button>
        <span class=-name title="${pathOf(name)}">${unhee(title.value) || name}</span>
        <select name=type setting="fields.${name}.type">${option('', set.type, t`automatic`)}${types.map((type) => option(type, set.type))}</select>
        <button type=button class="u2-unstyle -toggle" aria-expanded=false title="${t`Details`}"><u2-ico icon=expand_more>▾</u2-ico></button>
      </div>
      <div class=-flags>${FLAGS.map(([key, label]) =>
        html.async`<label><input type=checkbox setting="fields.${name}.${key}" ${checked(set[key])}>${label}</label>`)}</div>
      <div class=-more>
        <label>${t`Label`} (${lang}):<input value="${unhee(title.value)}" cmstxt=${title.id} cmslang=${lang}></label>
        <label>${t`Column`}:<input value="${pathOf(name)}" readonly></label>
        <label>${t`Default value`} <small>({user}, {id})</small>:<input setting="fields.${name}.default" value="${set.default ?? ''}"></label>
        <label>${t`Width`}:<input setting="fields.${name}.width" value="${set.width ?? ''}" placeholder="120"></label>
        <label>${t`Link to page`} (id/URL):<input setting="fields.${name}.link" value="${set.link ?? ''}"></label>
        <label class=-choices>${t`Choices, one per line (value=Label)`}:<textarea setting="fields.${name}.choices">${set.choices ?? ''}</textarea></label>
        <label class=-ref>${t`Label of the row pointed to`} (SQL):<input setting="fields.${name}.ref_label" value="${set.ref_label ?? ''}" placeholder="name"></label>
        <label class=-ref>${t`Rows offered`} (SQL WHERE):<input setting="fields.${name}.ref_where" value="${set.ref_where ?? ''}"></label>
        <label class=-size>${t`Size`}:<input setting="fields.${name}.size" value="${set.size ?? ''}" placeholder="30x20"></label>
        <label class=-cut>${t`Characters in the list`}:<input type=number setting="fields.${name}.cut" value="${set.cut ?? ''}"></label>
        <button type=button class=-remove>${t`Remove field`}</button>
      </div>
    </div>`;
  };

  await widget.html`<div class=-dbtable>
    <label>${t`Table`}:<select class=-table>${option('', settings.table, '–')}${tables.map((tb) => option(tb, settings.table))}</select></label>
    ${settings.table ? html.async`
      <details ${names.length ? '' : 'open'}><summary>${t`Columns`}</summary>
        <div class=-tree>${columns(settings.table, '')}</div>
      </details>
      <details open><summary>${t`Fields`} (${names.length})</summary>
        <div class=-list u2-dropzone>${names.map(field)}</div>
      </details>
      <details><summary>${t`List`}</summary>
        <label>${t`Rows per page`}:<input type=number setting=limit value="${settings.limit ?? 20}" min=1></label>
        <label>${t`Order`}:<input setting=order value="${settings.order ?? ''}" placeholder="name, date DESC" list=dbtable-fields></label>
        <label>${t`Search text to start with`}:<input setting=search value="${settings.search ?? ''}"></label>
        <label><input type=checkbox setting=search_reset ${checked(settings.search_reset)}> ${t`Each visit starts with it`}</label>
        <label><input type=checkbox setting=delete ${checked(settings.delete)}> ${t`Rows can be deleted`}</label>
        <label><input type=checkbox setting=copy ${checked(settings.copy)}> ${t`Rows can be copied`}</label>
        <label><input type=checkbox setting=export ${checked(settings.export)}> ${t`CSV export`}</label>
        <label>${t`Detail page of a row`} (id/URL):<input setting=detail_page value="${settings.detail_page ?? ''}"></label>
        <label>${t`Only rows where`} (SQL):<textarea setting=where>${settings.where ?? ''}</textarea></label>
        <datalist id=dbtable-fields>${names.map((n) => html`<option value="${n}">`)}</datalist>
      </details>
      <details class=-sqlBox><summary>SQL</summary><pre class=-sql></pre></details>` : ''}
  </div>`;

  bindSettings(widget, ref);

  widget.on('change', '.-dbtable .-table', async (sel) => {
    if (names.length && !await dialogs.confirm(await t`Change the table? The fields are removed.`)) return sel.value = settings.table ?? '';
    await call({ do: 'table', table: sel.value });
    widget.reload();
  });

  widget.on('click', '.-dbtable .-open', async (el) => {
    const li = el.closest('li');
    if (li.querySelector('ul')) return li.querySelector('ul').remove(), el.textContent = '▸';
    el.textContent = '▾';
    li.insertAdjacentHTML('beforeend', String(await columns(el.dataset.table, li.dataset.path + '.')));
  });

  widget.on('change', '.-dbtable .-use', async (box) => {
    const path = box.closest('li').dataset.path;
    if (box.checked) await call({ do: 'add', path });
    else await call({ do: 'remove', name: names.find((n) => pathOf(n) === path) });
    widget.reload();
  });

  widget.on('click', '.-dbtable :is(.-toggle, .-field .-name)', (el) => {
    const f = el.closest('.-field'), open = f.toggleAttribute('open');
    f.querySelector('.-toggle').setAttribute('aria-expanded', open);
  });

  widget.on('click', '.-dbtable .-remove', async (btn) => {
    await call({ do: 'remove', name: btn.closest('.-field').getAttribute('itemid') });
    widget.reload();
  });

  widget.on('u2-dropzone-drop', '.-dbtable .-list', (list, e) => {
    if (!e.detail?.add) return; // the same zone fires remove+add -> react only once
    requestAnimationFrame(() =>
      ref.settings.field_order.put({ value: [...list.children].map((c) => c.getAttribute('itemid')).join(',') }));
  });

  // loaded as it opens: the SQL changes with every setting
  widget.on('click', '.-dbtable .-sqlBox > summary', async (summary) => {
    if (!summary.parentNode.open) summary.nextElementSibling.textContent = (await call({ do: 'sql' })).sql;
  });
}
