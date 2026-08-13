// add files

import { api } from '@qino/pub/qino.js';

// scoped query helper
const find = (el, sel) => el.querySelector(':scope '+sel);

// The file-browser dialog lives in the CMS panel's shadow DOM.
customElements.whenDefined('qino-cms').then(async () => {
  const { SelectorObserver } = await import('@qino/u2/js/SelectorObserver/SelectorObserver.js');
  const root = document.querySelector('qino-cms').shadowRoot;
  new SelectorObserver({ on: el=>{

    const search = find(el, '[type=search]');
    const mainList = find(el, '.-list.-main');
    const container = c1.dom.el(
      `<div class=-pexels style="padding-top:2em;" hidden>
            <h3>
                Free images from:
                <a href="https://pexels.com/" target=_blank><img src="https://images.pexels.com/lib/api/pexels.png" style="height:1.5em; margin-left:.5em" alt="pexels.com"></a>
            </h3>
            <div class=-list></div>
        </div>`
    );
    mainList.after(container);

    const list = find(container, '.-list');

    search.addEventListener('input',c1.debounce(async () => {
      const hasPixabay = el.querySelector('.-pixabay');
      const items = await api['cms.filebrowser.pexels'].search.get({ s: search.value });
      list.innerHTML = '';
      let item;
      for (item of items) {
        if (hasPixabay && item.photographer === 'Pixabay') continue;
        const el = c1.dom.el(
          '<label data-type=url>'+
                    '<input type=checkbox style="position:absolute; top:.5rem; left:.5rem">'+
                    '<div class=-title></div>'+
                '</label>'
        );
        el.setAttribute('itemid', item.original);
        find(el, '.-title').textContent = item.width+'x'+item.height+' by:'+item.photographer;
        el.style.backgroundImage = 'url("'+item.medium+'")';
        list.append(el);
      }
      container.hidden = !item;
    }, 1500));

  }}).observe('.cmsFileBrowser', { root });
});
