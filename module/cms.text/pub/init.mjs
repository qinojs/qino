import { dom } from '@qino/pub/c1.js';
import { globalContextMenu } from '@qino/pub/c1/contextMenu.mjs';
import { SelectorObserver } from '@qino/u2/js/SelectorObserver/SelectorObserver.js';
import { api } from '@qino/pub/api.js';
import { ctx } from '@qino/pub/qino.js';
import { html, unhee } from '@qino/pub/html.js';
import { t } from '@qino/pub/t.js';

const moduleUrl = ctx.moduleUrl;
const nodeId = globalThis.qino?.cms?.nodeId;
const activeLang = document.documentElement.lang;

// contextmenu
globalContextMenu().addItem('CMS Text',{
  icon: moduleUrl+'cms.text/pub/module.svg',
  selector: '[cmstxt]',
  onshow(e) { this.qgCurrentTarget = e.currentTarget; },
  onclick() { showEditor(this.qgCurrentTarget); }
});

const showDialog = async (parts, style = '') => {
  const dialog = document.createElement('dialog');
  dialog.className = 'backdropClose';
  dialog.style.cssText = style;
  dialog.innerHTML = await html.async`<div style="display:flex">${parts}</div>`;
  dialog.firstElementChild.lastElementChild.style.borderRight = 'none';
  dialog.addEventListener('close', () => setTimeout(() => dialog.remove(), 2000));
  document.querySelector('qino-cms').shadowRoot.append(dialog);
  dialog.showModal();
  return dialog;
};

// like typing: cms.mjs saves it and mirrors it into the page
const setText = (field, text) => {
  if ('value' in field) field.value = unhee(text);
  else field.innerHTML = text;
  field.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
};

const showEditor = async el => {
  const tid = el.getAttribute('cmstxt');
  const data = await api['cms.text'].text(tid).get();
  const parts = [];
  for (const row of data) {
    let sourceLang = null;
    for (const item of data) {
      if (item.text !== false && item.lang !== row.lang) {
        sourceLang = item.lang;
        break;
      }
    }
    const text = (row.text===false?'':row.text);
    const style = 'border:2px solid var(--cms-dark); padding:.2rem; display:block; '+(row.lang===activeLang?'border-color:var(--cms-access-2)':'');
    const tag = el.tagName === 'TD' ? 'div' : el.tagName;
    parts.push(html.async`
        <div class=-language style="padding:1rem; min-width:20rem; border-right:1px solid">
            <div style="display:flex; align-items:center; margin-bottom:.5rem">
                <h2 style="text-transform:uppercase; margin:0 auto 0 0;${row.lang===activeLang?'color:var(--cms-access-2)':''}">${row.lang}</h2>
                ${sourceLang ? html.async`<button class=-translate data-source-lang="${sourceLang}">${t`translate from ${sourceLang}`}</button>` : ''}
                <button class=-history style="margin-left:.2em">${t`history`}</button>
                <!--button class=-continueAi style="margin-left:.2em" title="Is this useful? Feedback welcome!">AI extend (beta)</button-->
            </div>
            ${tag === 'INPUT'
              ? html`<input cmstxt=${tid} cmslang="${row.lang}" style="${style}" value="${unhee(text)}">`
              : html.raw(`<${tag} cmstxt=${tid} cmslang="${row.lang}" contenteditable style="${style}">${text}</${tag}>`)}
        </div>`);
  }
  // the t`` calls above are queued in one microtask, so they travel in a single request
  const dialog = await showDialog(parts, 'inset:auto 0 1rem 0');
  dialog.addEventListener('click',async e=>{
    if (!e.target.classList.contains('-translate')) return;
    const btn = e.target;
    const field = btn.closest('.-language').querySelector(':scope >[cmstxt]');
    const targetLang = field.getAttribute('cmslang');
    const sourceLang = btn.dataset.sourceLang;
    const { default: loading } = await import('@qino/pub/c1/loading.mjs');
    const unmark = loading.mark(e.target.closest('.-language'));
    try {
      await api['cms.text'].text(tid).translate.post({ targetLang, sourceLang });
      const rows = await api['cms.text'].text(tid).get();
      setText(field, rows.find(row => row.lang === targetLang).text);
    } catch (err) {
      await cms.dialogs.alert(err.message);
    }
    unmark();
  });
  dialog.addEventListener('click',async e=>{
    if (!e.target.classList.contains('-history')) return;
    const field = e.target.closest('.-language').querySelector(':scope >[cmstxt]');
    const history = await api['cms.text'].text(tid).history.get({ lang: field.getAttribute('cmslang') });
    const parts = history.map((row, i) => {
      const date = new Date(row.log_time*1000).toLocaleString(false, {dateStyle: 'short', timeStyle: 'short'});
      return html.async`
            <div style="padding:1rem; min-width:15rem; border-right:1px solid">
                <div style="display:flex; align-items:end; margin-bottom:.5rem">
                    <h2 style="margin:0 auto 0 0" title="${row.email}">${date}</h2>
                    <button class=-restore value=${i} style="white-space:nowrap">${t`restore`}</button>
                </div>
                <div style="min-height:2em; flex:1; border:.125rem solid var(--cms-dark); overflow:auto; padding:.2rem; max-height:70vh;">${html.raw(row.text ?? '')}</div>
            </div>`;
    });
    const hDialog = await showDialog(parts);
    hDialog.addEventListener('click', e => {
      if (!e.target.classList.contains('-restore')) return;
      setText(field, history[e.target.value].text ?? '');
      hDialog.close();
    });
  });
}

// mark untranslated / void texts
setTimeout(() => {
  document.head.append(dom.el(
    '<style>'+
    '  @keyframes qgCMS-text-untranslated { 0% { background-color: rgba(255,240,0,.4) } 50% {  } 100% {  } }'+
    '  .qgCMS-text-untranslated { animation:qgCMS-text-untranslated .8s infinite alternate; }'+
    '</style>'
  ));
  const pendingByLang = {};
  let batchTimer;
  new SelectorObserver({ on: el => {
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
  }}).observe('[cmstxt]');
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



/* translate whole page */
const addTranslateWidget = async el=>{
  el.insertAdjacentHTML('beforeend', await html.async`
        <div class="-widgetHead -open" tabindex=0><span class=-title>${t`Translate`}</span></div>
        <div>
            <form class=-content>
        <b>${activeLang}</b> ${t`texts on this page:`} <br>
                <button name=auto>${t`Auto-translate`}</button><br>
                <button name=clean>${t`Delete translations`}</button><br>
                <!--input name=subpages type=checkbox> including subpages<br-->
            </form>
        </div>
    `);
  el.lastElementChild.querySelector('form').addEventListener('submit',async e=>{
    e.preventDefault();
    const { default: loading } = await import('@qino/pub/c1/loading.mjs');
    const sourceLang = e.submitter.name;
    const done = loading.mark(e.target);
    try {
      const result = await api['cms.text'].page(nodeId).translate.post({ targetLang: activeLang, sourceLang, ifNeeded: true, subpages: false });
      await cms.dialogs.alert(t`translated texts: ${result.count}`);
      if (result.fail) await cms.dialogs.alert(t`not allowed on ${result.fail} pages`);
      result.count && location.reload();
    } catch (err) {
      await cms.dialogs.alert(err.message);
    }
    done();
  });
};
customElements.whenDefined('qino-cms').then(() => {
  const root = document.querySelector('qino-cms')?.shadowRoot;
  if (!root) return;
  new SelectorObserver({ on: addTranslateWidget }).observe('.-moreWidget', { root });
});
