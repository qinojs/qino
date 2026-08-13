import { api } from '@qino/pub/qino.js';

import { cms } from '../../cms/pub/js/cms.mjs';

const nodeId = globalThis.qino?.cms?.nodeId;

// The CMS panel (cms.frontend.2) lives in the shadow DOM of <qino-cms>.
const panelRoot = customElements.whenDefined('qino-cms').then(() => document.querySelector('qino-cms').shadowRoot);

panelRoot.then(async root => {
  const { SelectorObserver } = await import('@qino/u2/js/SelectorObserver/SelectorObserver.js');
  new SelectorObserver({ on: el => {
    const button = c1.dom.el('<button>select');
    el.after(button);
    button.addEventListener('click', () => {
      const fB = new cms.fileBrowser({ multiple:true });
      fB.show();
      fB.on('select', async e => {
        const pid = cms.cont.active || nodeId;
        for (const id of e.dbFiles) await api.cms.node(pid).files.post({ file: String(id) });
        for (const url of e.urls) await api.cms.node(pid).files.post({ file: url });
      });
    });
    el.style.display = 'none';
  }}).observe('.file-manager .-addExistingFile', { root });

  // replace file placeholders
  new SelectorObserver({ on: el => {
    el.addEventListener('click', e => {
      e.stopImmediatePropagation();
      const replace = e.target.closest('tr').getAttribute('itemid');
      const fB = new cms.fileBrowser({ multiple:false, local:1 });
      fB.show();
      fB.on('select', async e => {
        const pid = cms.cont.active || nodeId;
        const item = e.dbFiles[0] || e.urls[0];
        if (item) {
          await api.cms.node(pid).files.post({ file: String(item), replace });
          cms.reloadNode(pid);
        }
        if (e.files) cms.cont(pid).upload(e.files[0], () => cms.reloadNode(pid), replace);
      });
    });
  }}).observe('.file-manager .-preview', { root });
});


cms.fileBrowser = class {
  constructor(options={multiple:true}){
    this.options = options;
  }
  async show(){
    await Promise.all([
      import('@qino/pub/c1/loading.mjs'),
      import('@qino/pub/c1/form.mjs'),
    ]);
    const root = await panelRoot;
    const dialog = document.createElement('dialog');
    dialog.className = 'qgCMS cmsFileBrowser';
    dialog.innerHTML =
      '<header>Filebrowser</header>'+
      '<div>'+
      '  <input type=search placeholder="suchen..."> '+
      '  <button class=-browse '+(this.options.local?'':'hidden')+'>Lokale Dateien</button>'+
      '  <div class="-list -main"></div>'+
      '</div>'+
      '<footer>'+
      '  <button class=-cancel>Abbrechen</button>'+
      (this.options.multiple ? '  <button class=-ok>Ok</button>' : '')+
      '</footer>'+
      '<style>'+
      '.cmsFileBrowser {'+
      '  width:80rem;'+
      '  max-width:calc(100vw - 40px);'+
      '  max-height:calc(100vh - 40px);'+
      '  & .-list {'+
      '    min-height:40px;'+
      '    margin-top:1em;'+
      '    display:grid;'+
      '    grid-gap:3px;'+
      '    grid-template-columns:repeat(auto-fill, minmax(150px, 1fr));'+
      '    & label {'+
      '      position:relative;'+
      '      height:120px;'+
      '      border:1px solid #ddd;'+
      '      background:var(--cms-light) 50%/contain no-repeat;'+
      '      cursor:pointer;'+
      '      transition:transform .15s linear;'+
      '      &:hover {'+
      '        transform:scale(1.2);'+
      '        z-index:1;'+
      '      } '+
      '      & > .-title {'+
      '        position:absolute;'+
      '        bottom:0;'+
      '        right:0;'+
      '        left:0;'+
      '        background:rgba(0,0,0,.8);'+
      '        color:#fff;'+
      '        padding:10px;'+
      '        word-break:break-all;'+
      '        opacity:1;'+
      '        transition:opacity .6s;'+
      '      } '+
      '      &:hover > .-title {'+
      '        opacity:0;'+
      '      } '+
      (this.options.multiple ? '' : '      & > [type=checkbox] { display:none; } ')+
      '    } '+
      '  } '+
      '} '+
      '</style>';
    root.append(dialog);
    dialog.showModal();
    dialog.addEventListener('close', () => dialog.remove());
    dialog.addEventListener('mousedown', e => e.stopPropagation());

    const list = dialog.querySelector('.-list.-main');

    const select = elements => {
      this.trigger('select', elementsToItems(elements));
      dialog.close();
    };

    dialog.querySelector('.-cancel').addEventListener('click', () => dialog.close());
    dialog.querySelector('.-ok')?.addEventListener('click', () => {
      const elements = [...dialog.querySelectorAll('label[itemid]')].filter(el => el.querySelector('[type=checkbox]').checked);
      select(elements);
    });

    if (!this.options.multiple) {
      dialog.addEventListener('click', e => {
        const target = e.target.closest('label[itemid]');
        if (target) select([target]);
      });
    }

    function elementsToItems(elements){
      const items = {dbFiles:[], urls:[]};
      for (const el of elements) {
        const type = el.getAttribute('data-type')+'s';
        (items[type] ||= []).push(el.getAttribute('itemid'));
      }
      return items;
    }

    const searchInput = dialog.querySelector('[type=search]');
    searchInput.addEventListener('input', c1.debounce(() => search(searchInput.value), 600));

    dialog.querySelector('.-browse').addEventListener('click', async () => {
      const files = await c1.form.fileDialog({ accept:this.options.accept, multiple:this.options.multiple });
      this.trigger('select', { files, dbFiles:[], urls:[] });
      dialog.close();
    });

    const search = needle => {
      c1.loading.mark(list);
      api['cms.filebrowser'].search.get({ s: needle ?? '' }).then(result => {
        c1.loading.done(list);

        const has = {};
        for (const label of [...list.children]) {
          if (label.querySelector('[type=checkbox]')?.checked) has[label.getAttribute('itemid')] = 1;
          else label.remove();
        }

        for (const item of result) {
          if (has[item.id]) continue;
          const el = c1.dom.el(
            `<label data-type=dbFile>
              <div class=-ext style="position:absolute; inset:0; display:flex; justify-content:center; align-items:center; font-size:3.6em; color:#fff"></div>
              <input type=checkbox style="position:absolute; top:.8em; left:.8em">
              <div class=-title></div>
            </label>`
          );
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
Object.assign(cms.fileBrowser.prototype, c1.Eventer);
