/* Files of a node: upload, replace, reorder, delete. */
import { html } from '@qino/pub/html.js';
import { api, ctx, t } from '@qino/pub/qino.js';

export const css = `
/* fixed: the columns keep their declared width whatever the preview measures */
.-media .-list { width:100%; table-layout:fixed; }
.-media td { height:calc(var(--rem) * 3.8); vertical-align:middle; } /* room for the slot line, present or not */
.-media .-preview { width:calc(var(--rem) * 5.4); cursor:pointer; }
.-media .-preview > * { display:block; width:100%; height:calc(var(--rem) * 3.4); object-fit:contain; background:var(--cms-light); }
.-media .-link { white-space:nowrap; }
.-media .-link > a { display:block; overflow:hidden; text-overflow:ellipsis; }
.-media .-slot { font-size:calc(var(--rem) * .7); color:#999; font-style:italic; }
.-media .-size { width:calc(var(--rem) * 5); text-align:right; white-space:nowrap; }
/* u2 sizes icons in rem — pin them to our own anchor instead.
   The cell path is spelled out to outweigh .-styled's own padding rule */
.-media .-list > * > tr > :is(.-handle, .-delete) {
  width:calc(var(--rem) * 1.7); padding-inline:0; text-align:center; --size:calc(var(--rem) * 1.4); }
.-media .-list u2-ico { --size: calc(var(--rem) * 1.5); }
.-media .-handle { cursor:n-resize; }
.-media .-delete { cursor:pointer; }
.-media .-tools { display:flex; flex-wrap:wrap; gap:.5em; margin-bottom:.8em; }
.-media .-foot { text-align:right; }
`;

const kb = (size) => size ? Math.round(size / 1024) + ' KB' : '';

/** Read a File as a data: URI the files endpoint accepts, name included. */
const fileData = (file) => new Promise((ok, fail) => {
  const reader = new FileReader();
  reader.onerror = () => fail(reader.error);
  reader.onload = () => ok(String(reader.result).replace(';base64,', `;name=${file.name.replace(/[;,]/g, '_')};base64,`));
  reader.readAsDataURL(file);
});

const preview = (file) => file.thumb
  ? html`<img src="${file.thumb}" alt="" draggable=true ${file.ext === 'svg' ? 'height=40' : ''}>`
  : html`<svg viewBox="0 0 70 40"><rect width=70 height=40 fill="var(--cms-color)"></rect>
      <text x=35 y=24 fill=#fff text-anchor=middle>${file.placeholder ? 'upload' : file.ext}</text></svg>`;

// dynamic: draghandle pulls a cdn dependency that `deno check --all` cannot follow
const dnd = () => Promise.all([
  import('@qino/u2/attr/dropzone/dropzone.js'),
  import('@qino/u2/attr/draghandle/draghandle.js'),
]);

export default async function (el, { node, dialogs, signal }) {
  const ref = api.cms.node(node.id);
  const [files] = await Promise.all([
    ref.files.get({ thumb: '70x40' }, { signal }).then((f) => Object.entries(f ?? {})),
    dnd(),
  ]);
  const real = files.filter(([, f]) => !f.placeholder);

  el.head = t`Files`;
  el.badge = real.length;

  const row = ([slot, file]) => html.async`<tr itemid="${slot}" draggable>
    <td class=-preview title="${t`Click to replace the file`}">${preview(file)}
    <td class=-link>${file.placeholder
      ? t`Placeholder`
      : html`<a href="${file.url}" target=_blank title="${file.name}">${file.name}</a>`
    }${slot[0] === '_' ? '' : html`<div class=-slot>(${slot})</div>`}
    <td class=-size>${kb(file.size)}
    <td class=-handle u2-draghandle><u2-ico icon=drag1>⠿</u2-ico>
    <td class=-delete><u2-ico icon=delete>✕</u2-ico>`;

  await el.html`<div class=-media>
    <div class=-tools>
      <button type=button class=-upload>${t`upload`}</button>
      ${files.length > 1 ? html.async`
        <select class=-sort>
          <option value>${t`sort by...`}
          <option value=name>${t`Name`}
          <option value=name_reverse>${t`Name reversed`}
          <option value=date>${t`Date`}
          <option value=reverse>${t`reverse`}
        </select>
        <select class=-purge>
          <option value>${t`delete...`}
          <option value=double>${t`duplicates`}
          <option value=all>${t`all`}
        </select>` : ''}
    </div>
    ${files.length
      ? html.async`<table class="-list -styled"><tbody u2-dropzone>${files.map(row)}</tbody></table>
        ${real.length ? html.async`<div class=-foot>${real.length} ${t`Files`} |
          <a target=_blank href="${ctx.appUrl}?cms_nodeFilesZip=${node.id}">Download ZIP</a></div>` : ''}`
      : t`No files available`}
  </div>`;

  const upload = async (list, replace) => {
    for (const file of list) await ref.files.post({ file: await fileData(file), replace });
    el.reload();
  };
  const pick = (multiple) => new Promise((ok) => {
    const inp = Object.assign(document.createElement('input'), { type: 'file', multiple });
    inp.addEventListener('change', () => ok(inp.files), { once: true });
    inp.addEventListener('cancel', () => ok([]), { once: true });
    inp.click();
  });

  el.on('click', '.-upload', async () => upload(await pick(true)));
  el.on('click', '.-preview', async (td) => upload(await pick(false), td.closest('tr').getAttribute('itemid')));
  el.on('click', '.-delete', async (td) => {
    if (await dialogs.confirm(t`Really delete this file?`)) ref.files(td.closest('tr').getAttribute('itemid')).delete();
  });
  el.on('change', '.-sort', (sel) => sel.value && ref.files.order.post({ by: sel.value }).then(() => el.reload()));
  el.on('change', '.-purge', async (sel) => {
    if (sel.value === 'double') await ref.files.doubles.delete();
    if (sel.value === 'all' && await dialogs.confirm(t`Really delete all files?`)) await ref.files.all.delete();
  });
  el.on('u2-dropzone-drop', 'tbody', (body, e) => {
    if (!e.detail?.add) return; // the same zone fires remove+add -> react only once
    requestAnimationFrame(() => ref.files.put({ sort: [...body.children].map((r) => r.getAttribute('itemid')) }));
  });
}
