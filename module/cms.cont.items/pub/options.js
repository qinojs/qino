/* The options panel of a list: add an entry, sort them, rename, copy, delete.
 *
 * The successor of items2's options.php. The list lives here and not on the page because the
 * block already knows what an entry is — "Add entry" creates it without a module picker, and
 * nothing foreign can be dropped in between two entries. */
import { html } from '@qino/pub/html.js';
import { api } from '@qino/pub/api.js';
import { t } from '@qino/pub/t.js';

export const css = `
.-items {
  .-list { display:flex; flex-direction:column; gap:calc(var(--rem) * .25); }

  .-row {
    display:flex; align-items:center; gap:calc(var(--rem) * .25);
    padding:calc(var(--rem) * .15) calc(var(--rem) * .25);
    border:1px solid var(--cms-light);

    > input {
      flex:1 1 auto; min-width:calc(var(--rem) * 3);
      padding:calc(var(--rem) * .2);
      border:0; background:none; font:inherit;
      &:focus { outline:1px solid var(--cms-color); }
    }
    /* the module name, as quiet as the slot line in the media list */
    > .-mod { flex:0 0 auto; white-space:nowrap; font-size:calc(var(--rem) * .7); color:#999; }
    /* u2 sizes icons in rem — pin them to our own anchor, the way the other widgets do */
    > button { flex:0 0 auto; padding:0 .2em; --size:calc(var(--rem) * 1.4); }
    > .-handle { cursor:n-resize; }
  }

  .-empty { margin:calc(var(--rem) * .4) calc(var(--rem) * .25); color:#999; }
  .-add { width:100%; margin-top:calc(var(--rem) * .5); }
  /* The button stands where the entry appears, so above the list it needs the space below. */
  &.-top .-add { margin:0 0 calc(var(--rem) * .5); }

  table { margin-top:calc(var(--rem) * 1); }
  table :is(input, select) { width:100%; }
}
`;
const short = (module) => String(module ?? '').replace(/^cms\.cont\./, '').replace(/\./g, ' ');

/**
 * @param widget   the widget element: it renders (`html`), listens (`on`), reloads itself
 * @param context  `node`, `dialogs`, `signal` from the mount, plus two optional fixings:
 *                 `module` — what an entry is, and `position` ("top" / "bottom") — where a new
 *                 one goes. A listing module passes them when it re-exports this widget; then
 *                 there is nothing to choose and no control for it. Left out, both come from
 *                 the node's settings and the editor decides.
 */
export default async function (widget, { node, dialogs, signal, module: fixedModule, position: fixedPosition }) {
  const ref = api.cms.node(node.id);
  const [contents, settings, modules] = await Promise.all([
    ref.contents.get({}, { signal }),
    ref.settings.get({}, { signal }).catch(() => ({})),
    // only for the picker — a fixed module needs no list to choose from
    fixedModule ? [] : api.cms.modules.get({}, { signal }).catch(() => []),
    // dynamic: draghandle pulls a cdn dependency that `deno check --all` cannot follow
    import('@qino/u2/attr/dropzone/dropzone.js'),
    import('@qino/u2/attr/draghandle/draghandle.js'),
  ]);
  // Only the direct entries — contents.get returns the whole subtree.
  const rows = (contents ?? []).map((c) => ({ id: c.id, module: c.module, title: c.title }));
  const fixed = !!fixedModule;
  const module = fixedModule || String(settings?.['default module'] ?? '') || 'cms.cont.flexible';
  // The assignable content modules, plus whatever is set — a module the picker would not offer
  // must not silently disappear from the list and change what a new entry is.
  const conts = (modules ?? []).filter((m) => m.kind === 'cont');
  if (!fixed && !conts.some((m) => m.name === module)) conts.unshift({ name: module });
  conts.sort((a, b) => a.name.localeCompare(b.name));
  // Where a new entry goes — and, so the two agree, where the button that makes it sits.
  const positionFixed = !!fixedPosition;
  const onTop = (fixedPosition || String(settings?.['add position'] ?? '') || 'bottom') === 'top';
  widget.head = t`Entries`;
  widget.badge = rows.length;

  const row = (r) => html.async`<div class=-row itemid="${r.id}" draggable>
    <button type=button class="-handle u2-unstyle" u2-draghandle title="${t`Reorder`}"><u2-ico icon=drag1>⠿</u2-ico></button>
    <input value="${r.title ?? ''}" placeholder="${short(r.module)}" title="${t`Title`}">
    <span class=-mod title="${r.module}">${short(r.module)}</span>
    <button type=button class="-settings u2-unstyle" title="${t`Settings`}"><u2-ico inline icon=settings>⚙</u2-ico></button>
    <button type=button class="-copy u2-unstyle" title="${t`Copy`}"><u2-ico inline icon=copy>⧉</u2-ico></button>
    <button type=button class="-remove u2-unstyle" title="${t`Delete`}"><u2-ico inline icon=delete>✕</u2-ico></button>
  </div>`;

  const addButton = html`<button type=button class="-add u2-button">${t`Add entry`}</button>`;
  const list = rows.length
    ? html.async`<div class=-list u2-dropzone>${rows.map(row)}</div>`
    : html`<div class=-empty>${t`No entries yet.`}</div>`;

  await widget.html`<div class="-items ${onTop ? '-top' : ''}">
    ${onTop ? addButton : ''}
    ${list}
    ${onTop ? '' : addButton}
    ${fixed && positionFixed ? '' : html.async`<table class=-styled style="width:100%">
      ${fixed ? '' : html.async`<tr>
        <td>${t`Module of a new entry`}
        <td><select class=-default>${conts.map((m) =>
          html`<option value="${m.name}" ${m.name === module ? 'selected' : ''}>${short(m.name)}</option>`
        )}</select>`}
      ${positionFixed ? '' : html.async`<tr>
        <td>${t`New entries appear`}
        <td><select class=-position>
          <option value=bottom ${onTop ? '' : 'selected'}>${t`at the end`}</option>
          <option value=top ${onTop ? 'selected' : ''}>${t`at the beginning`}</option>
        </select>`}
    </table>`}
  </div>`;

  const rid = (row) => row.getAttribute('itemid');
  /** The page shows what this list edits, so every change redraws the block. */
  const redraw = () => cms.reloadNode?.(node.id);

  widget.on('change', '.-row > input', (inp) =>
    api.cms.node(rid(inp.closest('.-row'))).title.put({ value: inp.value }).then(redraw));

  widget.on('click', '.-settings', (btn) => cms.cont(rid(btn.closest('.-row'))).showWidget('options'));

  widget.on('click', '.-copy', async (btn) => {
    await api.cms.node(rid(btn.closest('.-row'))).copy.post();
    redraw();
    widget.reload();
  });

  widget.on('click', '.-remove', async (btn) => {
    const row = btn.closest('.-row');
    if (!await dialogs.confirm(t`Delete this entry?`)) return;
    await api.cms.node(rid(row)).delete();
    row.remove();
    widget.badge = widget.querySelectorAll('.-row').length;
    redraw();
  });

  widget.on('click', '.-add', async () => {
    const first = widget.querySelector('.-row');
    const made = await ref.contents.post({ module: widget.querySelector('.-default')?.value || module });
    // A fresh cont has no sort yet and children come back `ORDER BY type DESC, sort, id DESC`, so
    // where it lands is not decided by the creation. `insert-before` decides it: before the first
    // entry, or — with no `before` — after the last one.
    await ref['insert-before'].put({ id: String(made.id), before: onTop && first ? rid(first) : undefined });
    redraw();
    widget.reload();
  });

  widget.on('change', '.-position', async (sel) => {
    await ref.settings['add position'].put({ value: sel.value });
    widget.reload(); // the button changes sides
  });

  widget.on('change', '.-default', (sel) =>
    ref.settings['default module'].put({ value: sel.value }));

  /* reorder: u2-dropzone reorders the dom on drop; the moved row's new neighbour is the anchor */
  widget.on('u2-dropzone-drop', '.-list', (_list, e) => {
    const moved = e.detail?.add;
    if (!moved) return; // the same zone fires remove+add — react only once
    requestAnimationFrame(async () => {
      const before = moved.nextElementSibling;
      await ref['insert-before'].put({ id: rid(moved), before: before ? rid(before) : undefined });
      redraw();
    });
  });
}
