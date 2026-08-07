import '../../core/pub/js/c1.js';
import '../../core/pub/js/c1/fix/contextMenu.mjs';
import '../../core/pub/js/c1/contextMenu.mjs';
import '../../core/pub/js/c1/onElement.mjs';
import { api, ctx } from '../../core/pub/js/qino.js';

const moduleUrl = ctx.moduleUrl;
const nodeId = globalThis.qino?.cms?.nodeId;
const activeLang = document.documentElement.lang;

// contextmenu
c1.globalContextMenu.addItem('CMS Text',{
  icon: moduleUrl+'cms.text/pub/text.png',
  selector: '[cmstxt]',
  onshow(e) { this.qgCurrentTarget = e.currentTarget; },
  onclick() { showEditor(this.qgCurrentTarget); }
});

const showEditor = async el => {
  const tid = el.getAttribute('cmstxt');
  const data = await api['cms.text'].text(tid).get();
  const dialog = document.createElement('dialog');
  dialog.className = 'qgCMS';
  let body = '<div style="display:flex">';
  for (const row of data) {
    let source_lang = null;
    for (const item of data) {
      if (item.text !== false && item.lang !== row.lang) {
        source_lang = item.lang;
        break;
      }
    }
    const text = (row.text===false?'':row.text);
    const style = 'border:2px solid var(--cms-dark); padding:.2rem; display:block; '+(row.lang===activeLang?'border-color:var(--cms-access-2)':'');
    const tag = el.tagName === 'TD' ? 'div' : el.tagName;
    body +=
        '<div class=-language style="padding:1rem; min-width:20rem; border-right:1px solid">'+
            '<div style="display:flex; align-items:center; margin-bottom:.5rem">'+
                '<h2 style="text-transform:uppercase; margin:0 auto 0 0;'+(row.lang===activeLang?'color:var(--cms-access-2)':'')+'">'+row.lang+'</h2> '+
                (source_lang?
                  '<button class=-translate source_lang="'+source_lang+'">translate from '+source_lang+'</button>':'')+
                '<button class=-history style="margin-left:.2em">history</button>'+
        //'<button class=-continueAi style="margin-left:.2em" title="Is this useful? Feedback welcome!">AI extend (beta)</button>'+
            '</div>'+
      (tag === 'INPUT'
        ? '<'+tag+' cmstxt='+tid+' cmslang="'+row.lang+'" style="'+style+'" value="'+hee(text)+'">'
        : '<'+tag+' cmstxt='+tid+' cmslang="'+row.lang+'" contenteditable style="'+style+'">'+text+'</'+tag+'>'
      )+
        '</div>';
  }
  body += '</div>';
  dialog.innerHTML = body;
  dialog.style.cssText = 'inset: auto 0 0 0; box-shadow:0 0 1rem #0008; border:0; padding:0';
  dialog.addEventListener('click', e => e.target === dialog && dialog.close() );
  dialog.addEventListener('click',async e=>{
    if (!e.target.classList.contains('-translate')) return;
    const btn = e.target;
    const target_lang = btn.closest('.-language').querySelector(':scope >[cmstxt]').getAttribute('cmslang');
    const source_lang = btn.getAttribute('source_lang');
    const loading = await import('../../core/pub/js/c1/loading.mjs').then(m => m.default);
    const unmark = loading.mark(e.target.closest('.-language'));
    try {
      await api['cms.text'].text(tid).translate.post({ target_lang, source_lang });
      dialog.close();
      showEditor(el);
    } catch (err) {
      alert(err.message);
    }
    unmark();
  });
  dialog.addEventListener('click',async e=>{
    if (!e.target.classList.contains('-history')) return;
    const lang = e.target.closest('.-language').querySelector(':scope >[cmstxt]').getAttribute('cmslang');
    const history = await api['cms.text'].text(tid).history.get({ lang });
    const hDialog = document.createElement('dialog');

    hDialog.className = 'qgCMS';
    let body = '<div style="display:flex;">';
    for (const row of history) {
      const date = new Date(row.log_time*1000).toLocaleString(false, {dateStyle: 'short', timeStyle: 'short'});
      body +=
            '<div class=-language style="padding:1rem; min-width:15rem; border-right:1px solid">'+
                '<div style="display:flex; align-items:end; margin-bottom:.5rem">'+
                    '<h2 style="margin:0 auto 0 0" title="'+hee(row.email ?? '')+'">'+date+'</h2> '+
                    '<button class=-restore style="white-space:nowrap">restore</button>'+
                '</div>'+
                '<div cmstxt='+tid+' cmslang="'+lang+'" style="min-height:2em; flex:1; border:.125rem solid var(--cms-dark); overflow:auto; padding:.2rem; max-height:70vh;">'+
                    (row.text===false?'':row.text)+
                '</div>'+
            '</div>';
    }
    body += '</div>';
    hDialog.innerHTML = body;
    hDialog.style.cssText = 'inset: 0 0 0 0; box-shadow:0 0 1rem #0008; border:0; padding:0';
    document.body.append(hDialog);
    hDialog.addEventListener('click', e => e.target === hDialog && hDialog.close() );
    hDialog.addEventListener('click', async e => {
      if (!e.target.classList.contains('-restore')) return;
      const historyItem = e.target.closest('.-language');
      const textEl = historyItem.querySelector('[cmstxt]');
      const lang = textEl.getAttribute('cmslang');
      const textContent = textEl.tagName === 'INPUT' ? textEl.value : textEl.innerHTML;

      // Restore the text
      const loading = await import('../../core/pub/js/c1/loading.mjs').then(m => m.default);
      const unmark = loading.mark(historyItem);
      const success = await api.cms.txt(parseInt(tid)).put({ value: textContent, lang });
      unmark();

      if (success) {
        hDialog.close();
        dialog.close();
        showEditor(el); // Reload the main editor with restored content
      } else {
        alert('Failed to restore');
      }
    });
    hDialog.addEventListener('close', () => setTimeout(() => hDialog.remove(), 2000));
    hDialog.showModal();
  });
  dialog.addEventListener('close', () => setTimeout(() => dialog.remove(), 2000));
  document.body.append(dialog);
  dialog.showModal();
}

// mark untranslated / void texts
setTimeout(() => {
  document.head.append(c1.dom.fragment(
    '<style>'+
    '  @keyframes qgCMS-text-untranslated { 0% { background-color: rgba(255,240,0,.4) } 50% {  } 100% {  } }'+
    '  .qgCMS-text-untranslated { animation:qgCMS-text-untranslated .8s infinite alternate; }'+
    '</style>'
  ));
  const pendingByLang = {};
  let batchTimer;
  c1.onElement('[cmstxt]', el => {
    const id = el.getAttribute('cmstxt');
    const lang = el.getAttribute('cmslang') || activeLang;
    (pendingByLang[lang] ??= []).push({ id, el });
    clearTimeout(batchTimer);
    batchTimer = setTimeout(async () => {
      for (const [lang, entries] of Object.entries(pendingByLang)) {
        delete pendingByLang[lang];
        const ids = entries.map(e => Number(e.id));
        const result = await api['cms.text'].text['are-translated'].get({ ids: ids.join('_'), lang });
        for (const { id, el } of entries) {
          if (!result[id]) el.classList.add('qgCMS-text-untranslated');
        }
      }
    }, 50);
  });
  api.on('PUT cms/txt/:id', ({ params: { id }, input }) => {
    const txt = input?.value;
    const setLang = input?.lang || activeLang;
    const els = document.querySelectorAll('[cmstxt="'+id+'"]');
    for (const el of els) {
      const elLang = el.getAttribute('cmslang') || activeLang;
      if (setLang !== elLang) continue;
      el.classList.toggle('qgCMS-text-untranslated', !txt);
    }
  });
},100);


function hee(string){
  return string.replace(/[\u00A0-\u9999<>\&]/gim, i => '&#'+i.charCodeAt(0)+';');
}


/* translate hole page */
const addTranslateWidget = el=>{
  const lang = document.documentElement.getAttribute('lang');
  const fragment = c1.dom.fragment(`
        <div class="-widgetHead -open" tabindex=0><span class=-title>Translate</span></div>
        <div>
            <form class=-content>
        <b>${lang}</b> texts on this page: <br>
                <button name=auto>Auto-translate</button><br>
                <button name=clean>Delete translations</button><br>
                <!--input name=subpages type=checkbox> including subpages<br-->
            </form>
        </div>
    `);
  fragment.querySelector('form').addEventListener('submit',async e=>{
    e.preventDefault();
    await import('../../core/pub/js/c1/loading.mjs');
    const sourceLang = e.submitter.name;
    const done = c1.loading.mark(e.target);
    try {
      const result = await api['cms.text'].page(nodeId).translate.post({ target_lang: lang, source_lang: sourceLang, ifNeeded: true, subpages: false });
      alert('translated texts: '+result.count);
      if (result.fail) alert('not allowed on '+result.fail+' pages');
      result.count && location.reload();
    } catch (err) {
      alert(err.message);
    }
    done();
  });
  el.append(fragment);
};
c1.onElement('.qgCmsFront1MoreManager', addTranslateWidget);
customElements.whenDefined('qino-cms').then(async () => {
  const root = document.querySelector('qino-cms')?.shadowRoot;
  if (!root) return;
  const { SelectorObserver } = await import('@qino/u2/js/SelectorObserver/SelectorObserver.js');
  new SelectorObserver({ on: addTranslateWidget }).observe('.more-manager', { root });
});
