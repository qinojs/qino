// add files
import { u2Base } from '../../core/pub/js/qino.js';

// Der Filebrowser-Dialog lebt im Shadow-DOM des CMS-Panels.
customElements.whenDefined('qino-cms-panel').then(async () => {
const { SelectorObserver } = await import(u2Base + 'js/SelectorObserver/SelectorObserver.js');
const root = document.querySelector('qino-cms-panel').shadowRoot;
new SelectorObserver({ on: el=>{

    const search = el.c1Find('[type=search]');
    const mainList = el.c1Find('.-list.-main');
    const container = c1.dom.fragment(
        `<div class=-pexels style="padding-top:2em;" hidden>
            <h3>
                Free images from:
                <a href="https://pexels.com/" target=_blank><img src="http://images.pexels.com/lib/api/pexels.png" style="height:1.5em; margin-left:.5em" alt="pexels.com"></a>
            </h3>
            <div class="-list"></div>
        </div>`
    ).firstChild;
    mainList.after(container);

    const list = container.c1Find('.-list');

    search.addEventListener('input',async function(e){
        const hasPixabay = el.querySelector('.-pixabay');
        const API_KEY = '563492ad6f917000010000011de0136108e248e08b32b1cc22561149'; // todo: from server
        const url = 'https://api.pexels.com/v1/search?per_page=50&page=1&query='+encodeURIComponent(e.target.value);
        const response = await fetch(url,{
            headers: {'Authorization': API_KEY}
        });
        const data = await response.json();
        list.innerHTML = '';
        let item;
        for (item of data.photos) {
            if (hasPixabay && item.photographer === 'Pixabay') continue;
            const el = c1.dom.fragment(
                '<label data-type=url itemid="'+item.src.original+'">'+
                    '<input type="checkbox" style="position:absolute; top:8px; left:8px">'+
                    '<div class=-title>'+
                        item.width+'x'+item.height+' by:'+item.photographer+
                    '</div>'+
                '</label>'
            ).firstChild;
            el.style.backgroundImage = 'url("'+item.src.medium+'")';
            list.append(el);
        }
        container.hidden = !item;
    }.c1Debounce(1500));

}}).observe('.cmsFileBrowser', { root });
});
