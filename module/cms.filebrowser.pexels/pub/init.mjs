import { debounce, dom } from '@qino/pub/c1.js';
import { api } from '@qino/pub/api.js';
import { t } from '@qino/pub/t.js';
import { mark } from '@qino/u2/js/loading/loading.js';

// scoped query helper
const find = (el, sel) => el.querySelector(':scope '+sel);

// The file-browser dialog lives in the CMS panel's shadow DOM.
customElements.whenDefined('qino-cms').then(async () => {
  const { SelectorObserver } = await import('@qino/u2/js/SelectorObserver/SelectorObserver.js');
  const root = document.querySelector('qino-cms').shadowRoot;
  new SelectorObserver({ on: el=>{

    const search = find(el, '[type=search]');
    const tab = dom.el('<h4 slot=title>Pexels</h4>');
    const panel = dom.el(
      `<section class=-pexels>
            <p>
                Free images from:
                <a href="https://pexels.com/" target=_blank><img src="https://images.pexels.com/lib/api/pexels.png" style="height:1.5em; margin-left:.5em" alt="pexels.com"></a>
            </p>
            <div class=-list></div>
        </section>`
    );
    find(el, 'u2-tabs').append(tab, panel);

    const list = find(panel, '.-list');

    // only the open tab queries the API
    let searched = null;
    const run = async () => {
      if (panel.hidden || search.value === searched) return;
      searched = search.value;
      const hasPixabay = el.querySelector('.-pixabay');
      mark(list, { delay: 150 }); // ends itself when the list changes
      const items = await api['cms.filebrowser.pexels'].search.get({ s: search.value });
      if (!items.length) {
        const empty = dom.el('<p class=-empty></p>');
        if (search.value) empty.textContent = await t.in('cms')`No results found`;
        return list.replaceChildren(empty);
      }
      list.innerHTML = '';
      for (const item of items) {
        if (hasPixabay && item.photographer === 'Pixabay') continue;
        const el = dom.el(
          '<label data-type=url>'+
                    '<input type=checkbox>'+
                    '<div class=-title></div>'+
                '</label>'
        );
        el.setAttribute('itemid', item.original);
        find(el, '.-title').textContent = item.width+'x'+item.height+' by:'+item.photographer;
        el.style.backgroundImage = 'url("'+item.medium+'")';
        list.append(el);
      }
    };
    search.addEventListener('input', debounce(run, 1500));
    tab.addEventListener('u2-activate', () => queueMicrotask(run)); // u2-tabs shows the panel right after the event

  }}).observe('.cmsFileBrowser', { root });
});
