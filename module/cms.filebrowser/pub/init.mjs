import { debounce, Eventer, dom } from '@qino/pub/c1.js';
import { api } from '@qino/pub/api.js';
import { t } from '@qino/pub/t.js';
import { hee } from '@qino/pub/html.js';

import { cms } from '@qino/m/cms/pub/js/cms.js';

const nodeId = globalThis.qino?.cms?.nodeId;

// The CMS panel lives in the shadow DOM of <qino-cms>.
const panelRoot = customElements.whenDefined('qino-cms').then(() => document.querySelector('qino-cms').shadowRoot);

const pid = () => cms.cont.active || nodeId;
// a list entry as selection: what select hands on, plus what the preview shows
const pick = label => {
  const img = label.querySelector('img');
  return {
    id: label.getAttribute('itemid'),
    type: label.dataset.type,
    title: label.querySelector('.-title')?.textContent ?? '',
    image: label.style.backgroundImage || (img ? `url("${img.src}")` : ''),
    ext: label.querySelector('.-ext')?.textContent ?? '',
  };
};
const browse = (options, onSelect) => {
  const fB = new cms.fileBrowser(options);
  fB.show();
  fB.on('select', onSelect);
};
// the panel reloads its media widget on the POST itself
const addFiles = async (e) => {
  for (const item of [...e.dbFiles, ...e.urls]) await api.cms.node(pid()).files.post({ file: String(item) });
};
// the frontend calls this instead of its own local-file picker
cms.replaceFile = (node, replace) => browse({ multiple: false, local: 1 }, async e => {
  const item = e.dbFiles[0] || e.urls[0];
  if (item) {
    await api.cms.node(node).file(replace).put({ file: String(item) });
    cms.reloadNode(node);
  }
  if (e.files) cms.cont(node).upload(e.files[0], () => cms.reloadNode(node), replace);
});

panelRoot.then(async root => {
  const { SelectorObserver } = await import('@qino/u2/js/SelectorObserver/SelectorObserver.js');

  new SelectorObserver({ on: async tools => {
    const button = dom.el('<button>' + await t`existing file`);
    button.addEventListener('click', () => browse({ multiple: true }, addFiles));
    tools.querySelector('.-upload').after(button);
  }}).observe('.-media .-tools', { root });

  new SelectorObserver({ on: el => el.addEventListener('click', e => {
    e.stopImmediatePropagation();
    cms.replaceFile(pid(), e.target.closest('tr').getAttribute('itemid'));
  })}).observe('.file-manager .-preview', { root });
});


cms.fileBrowser = class {
  constructor(options={multiple:true}){
    this.options = options;
  }
  async show(){
    const [loading, { default: form }] = await Promise.all([
      import('@qino/u2/js/loading/loading.js'),
      import('@qino/pub/c1/form.mjs'),
    ]);
    const root = await panelRoot;
    const [title, placeholder, upload, cancel, ok] = (await Promise.all([t`Files`, t`Search...`, t`upload`, t`Cancel`, t`ok`])).map(hee);
    const dialog = document.createElement('dialog');
    dialog.className = 'qgCMS cmsFileBrowser';
    // sources (cms.filebrowser.*) add a tab: <h4 slot=title> + <section> into u2-tabs; they share the input
    dialog.innerHTML = `
      <form class=-search>
        <input type=search placeholder="${placeholder}">
        <button type=button class=-browse ${this.options.local ? '' : 'hidden'}>${upload}</button>
      </form>
      <u2-tabs>
        <h4 slot=title>${title}</h4>
        <section><div class="-list -main"></div></section>
      </u2-tabs>
      <footer>
        <div class=-picked></div>
        <button class=-cancel>${cancel}</button>
        ${this.options.multiple ? `<button class=-ok>${ok}</button>` : ''}
      </footer>
      <style>
      .cmsFileBrowser {
        width:80rem;
        max-width:calc(100vw - 2.5rem);
        height:calc(100vh - 2.5rem);
        &[open] {
          display:flex;
          flex-direction:column;
        }
        & > .-search {
          display:flex;
          gap:.5rem;
          padding-bottom:0;
          & > [type=search] { flex:1; }
        }
        & > u2-tabs {
          flex:1;
          min-height:0;
          padding:0;
        }
        & u2-tabs > section { padding-inline:0; } /* flush with the search field */
        & u2-tabs::part(panels) {
          flex:1;
          grid-template-rows:minmax(0, 1fr);
        }
        & > footer { align-items:end; }
        & .-picked {
          flex:1;
          min-width:0;
          display:flex;
          gap:3px;
          overflow-x:auto;
          & > button {
            flex:0 0 auto;
            width:3rem;
            height:3rem;
            padding:0;
            margin:0;
            border:1px solid #ddd;
            background:var(--cms-light) 50%/cover no-repeat;
            font-size:.7rem;
            cursor:pointer;
          }
        }
        & .-list {
          min-height:2.5rem;
          & > .-empty { grid-column:1 / -1; }
          display:grid;
          gap:3px;
          grid-template-columns:repeat(auto-fill, minmax(9.5rem, 1fr));
          & label {
            position:relative;
            height:7.5rem;
            border:1px solid #ddd;
            background:var(--cms-light) 50%/contain no-repeat;
            cursor:pointer;
            transition:transform .15s linear;
            &:hover {
              transform:scale(1.2);
              z-index:1;
            }
            & > [type=checkbox] {
              position:absolute;
              top:.5rem;
              left:.5rem;
              ${this.options.multiple ? '' : 'display:none;'}
            }
            & > .-ext {
              position:absolute;
              inset:0;
              display:flex;
              justify-content:center;
              align-items:center;
              font-size:3.6em;
              color:#fff;
            }
            & > .-title {
              position:absolute;
              bottom:0;
              right:0;
              left:0;
              background:rgba(0,0,0,.8);
              color:#fff;
              padding:.6rem;
              word-break:break-all;
              opacity:1;
              transition:opacity .6s;
            }
            &:hover > .-title { opacity:0; }
          }
        }
      }
      </style>`;
    root.append(dialog);
    dialog.showModal();
    dialog.addEventListener('close', () => dialog.remove());
    dialog.addEventListener('mousedown', e => e.stopPropagation());

    const list = dialog.querySelector('.-list.-main');

    const select = picks => {
      this.trigger('select', toItems(picks));
      dialog.close();
    };

    dialog.querySelector('.-cancel').addEventListener('click', () => dialog.close());
    dialog.querySelector('.-ok')?.addEventListener('click', () => select([...picked.values()]));

    if (!this.options.multiple) {
      dialog.addEventListener('click', e => {
        const target = e.target.closest('label[itemid]');
        if (target) select([pick(target)]);
      });
    }

    function toItems(picks){
      const items = {dbFiles:[], urls:[]};
      for (const { id, type } of picks) (items[type+'s'] ||= []).push(id);
      return items;
    }

    const searchInput = dialog.querySelector('[type=search]');
    searchInput.addEventListener('input', debounce(() => search(searchInput.value), 600));
    dialog.querySelector('.-search').addEventListener('submit', e => e.preventDefault()); // sources act on submit themselves

    // the selection lives here, not in the lists: it survives searches and tab switches
    const picked = new Map();
    const bar = dialog.querySelector('.-picked');
    const boxes = () => dialog.querySelectorAll('label[itemid] > [type=checkbox]');
    const sync = () => { for (const box of boxes()) box.checked = picked.has(box.parentNode.getAttribute('itemid')); };
    const showPicked = () => bar.replaceChildren(...[...picked.values()].map(p => {
      const thumb = dom.el('<button type=button></button>');
      thumb.title = p.title;
      if (p.image) thumb.style.backgroundImage = p.image;
      else thumb.textContent = p.ext;
      thumb.addEventListener('click', () => { picked.delete(p.id); sync(); showPicked(); });
      return thumb;
    }));
    dialog.addEventListener('change', e => {
      const label = e.target.closest('label[itemid]');
      if (!label) return;
      if (e.target.checked) picked.set(label.getAttribute('itemid'), pick(label));
      else picked.delete(label.getAttribute('itemid'));
      showPicked();
    });
    new MutationObserver(sync).observe(dialog.querySelector('u2-tabs'), { childList: true, subtree: true }); // re-rendered lists

    dialog.querySelector('.-browse').addEventListener('click', async () => {
      const files = await form.fileDialog({ accept:this.options.accept, multiple:this.options.multiple });
      this.trigger('select', { files, dbFiles:[], urls:[] });
      dialog.close();
    });

    const search = needle => {
      loading.mark(list, { delay: 150 }); // dims the current tiles; ends itself when the list changes
      api['cms.filebrowser'].search.get({ s: needle ?? '' }).then(async result => {
        if (!result.length) {
          const empty = dom.el('<p class=-empty></p>');
          empty.textContent = await (needle ? t.in('cms')`No results found` : t.in('cms')`No files available`);
          return list.replaceChildren(empty);
        }
        list.replaceChildren();
        for (const item of result) {
          const el = dom.el('<label data-type=dbFile><div class=-ext></div><input type=checkbox><div class=-title></div></label>');
          el.setAttribute('itemid', item.id);
          el.querySelector('.-title').textContent = item.name;
          if (item.mime.includes('image/')) el.style.backgroundImage = 'url("'+item.url+'")';
          else el.querySelector('.-ext').textContent = item.name.replace(/.*\.([^.]+)$/,'$1').slice(-4).toUpperCase();
          list.append(el);
        }
      });
    }
    search();
  }
}
Object.assign(cms.fileBrowser.prototype, Eventer);
