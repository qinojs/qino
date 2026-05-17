/* Copyright (c) 2016 Tobias Buschor https://goo.gl/gl0mbf | MIT License https://goo.gl/HgajeK */
import '../../core/pub/js/c1/fix/contextMenu.mjs';
import '../../core/pub/js/c1/contextMenu.mjs';
import { apt } from '../../core/pub/js/apt.js';

const activeLang = document.documentElement.lang;

// contextmenu
c1.globalContextMenu.addItem('CMS Text',{
	icon: sysURL+'cms.text/pub/text.png',
	selector: '[cmstxt]',
	onshow(e) { this.qgCurrentTarget = e.currentTarget; },
	onclick() { showEditor(this.qgCurrentTarget); }
});

let showEditor = async function(el) {
    const tid = el.getAttribute('cmstxt');
    const data = await apt['cms.text'].text(tid).get();
    let dialog = document.createElement('dialog');
    dialog.className = 'qgCMS q1Rst';
    let body = '<div style="display:flex">';
    for (let row of data) {
        let source_lang = null;
        for (let item of data) {
            if (item.text !== false && item.lang !== row.lang) {
                source_lang = item.lang;
                break;
            }
        }
		const text = (row.text===false?'':row.text);
		const style = 'border:2px solid var(--cms-dark); padding:.2rem; display:block; '+(row.lang===activeLang?'border-color:var(--cms-access-2)':'');
        body +=
        '<div class=-language style="padding:1rem; min-width:20rem; border-right:1px solid">'+
            '<div style="display:flex; align-items:center; margin-bottom:.5rem">'+
                '<h2 style="text-transform:uppercase; margin:0 auto 0 0;'+(row.lang===activeLang?'color:var(--cms-access-2)':'')+'">'+row.lang+'</h2> '+
                (source_lang?
                '<button class=-translate source_lang="'+source_lang+'">translate from '+source_lang+'</button>':'')+
                '<button class=-history style="margin-left:.2em">history</button>'+
                //'<button class=-continueAi style="margin-left:.2em" title="Ist das nützlich? Feedback wilkommen!">KI ergänzen (beta)</button>'+
            '</div>'+
			(el.tagName === 'INPUT'
				? '<'+el.tagName+' cmstxt='+tid+' cmslang="'+row.lang+'" style="'+style+'" value="'+hee(text)+'">'
			 	: '<'+el.tagName+' cmstxt='+tid+' cmslang="'+row.lang+'" contenteditable style="'+style+'">'+text+'</'+el.tagName+'>'
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
        const target_lang = btn.closest('.-language').c1Find('>[cmstxt]').getAttribute('cmslang');
        const source_lang = btn.getAttribute('source_lang');
        const [loading] = await c1.c1Use('loading');
        const unmark = loading.mark(e.target.closest('.-language'));
        const done = await apt['cms.text'].text(tid).translate.post({ target_lang, source_lang });
        dialog.close();
        done ? showEditor(el) : alert('Failed');
        unmark();
    });
    dialog.addEventListener('click',async e=>{
        if (!e.target.classList.contains('-history')) return;
        const lang = e.target.closest('.-language').c1Find('>[cmstxt]').getAttribute('cmslang');
        const history = await apt['cms.text'].text(tid).history.get({ lang });
        const hDialog = document.createElement('dialog');

        hDialog.className = 'qgCMS q1Rst';
        let body = '<div style="display:flex;">';
        for (let row of history) {
            const date = new Date(row.log_time*1000).toLocaleString(false, {dateStyle: 'short', timeStyle: 'short'});
            body +=
            '<div class=-language style="padding:1rem; min-width:15rem; border-right:1px solid">'+
                '<div style="display:flex; align-items:end; margin-bottom:.5rem">'+
                    '<h2 style="margin:0 auto 0 0" title="'+row.email+'">'+date+'</h2> '+
                    '<button class=-restore style="white-space:nowrap">restore</button>'+
                '</div>'+
                '<div cmstxt='+tid+' cmslang="'+lang+'" style="min-height:2em; flex:1; border:2px solid var(--cms-dark); overflow:auto; padding:.2rem; max-height:70vh;">'+
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
            const [loading] = await c1.c1Use('loading');
            const unmark = loading.mark(historyItem);
            const success = await apt.cms.txt(parseInt(tid)).put({ value: textContent, lang });
            unmark();
            
            if (success) {
                hDialog.close();
                dialog.close();
                showEditor(el); // Reload the main editor with restored content
            } else {
                alert('Failed to restore');
            }
        });        
        hDialog.addEventListener('close', () => {
            setTimeout(()=>hDialog.remove(),2000);
        });
        hDialog.showModal();
    });
    dialog.addEventListener('close', () => {
        setTimeout(()=>dialog.remove(),2000);
    });
    document.body.append(dialog);
	dialog.showModal();
}

// mark untranslated / void texts
setTimeout(function(){
	document.head.append(c1.dom.fragment(
		'<style>'+
		'  @keyframes qgCMS-text-untranslated { 0% { background-color: rgba(255,240,0,.4) } 50% {  } 100% {  } }'+
		'  .qgCMS-text-untranslated { animation:qgCMS-text-untranslated .8s infinite alternate; }'+
		'</style>'
	));
	c1.onElement('[cmstxt]', async el=>{
		const id = el.getAttribute('cmstxt');
		const lang = el.getAttribute('cmslang') || activeLang;
		const ok = await apt['cms.text'].text(id)['is-translated'].get({ lang });
		if (ok) return;
		el.classList.add('qgCMS-text-untranslated');
	});
	apt.on('PUT cms/txt/:id', ({ params: { id }, input }) => {
		const txt = input?.value;
		const setLang = input?.lang || activeLang;
		const els = document.querySelectorAll('[cmstxt="'+id+'"]');
		for (let el of els) {
			const elLang = el.getAttribute('cmslang') || activeLang;
			if (setLang !== elLang) continue;
			el.classList[txt?'remove':'add']('qgCMS-text-untranslated');
		}
	});
},100);


function hee(string){
	return string.replace(/[\u00A0-\u9999<>\&]/gim, function(i) {
	   return '&#'+i.charCodeAt(0)+';';
	});
}


/* translate hole page */
c1.onElement('.qgCmsFront1MoreManager', el=>{
    var lang = document.documentElement.getAttribute('lang');
    var fragment = c1.dom.fragment(`
        <div class="-widgetHead -open" tabindex="0"><span class="-title">Translate</span></div>
        <div>
            <form class=-content>
				<b>${lang}</b>-Texte dieser Seite: <br>
                <button name=auto>Automatisch übersetzen</button><br>
                <button name=clean>Übersetzungen löschen</button><br>
                <!--input name=subpages type=checkbox> inklusive Unterseiten<br-->
            </form>
        </div>
    `);
    fragment.querySelector('form').addEventListener('submit',async e=>{
        e.preventDefault();
        const inps = e.target.elements;
        await c1.c1Use('loading');
		let sourceLang = e.submitter.name;
        var done = c1.loading.mark(e.target);
        const result = await apt['cms.text'].page(Page).translate.post({ target_lang: lang, source_lang: sourceLang, ifNeeded: true, subpages: false });
        //const result = await apt['cms.text'].page(Page).translate.post({ target_lang: lang, source_lang: 'auto', ifNeeded: inps.if_needed.checked, subpages: inps.subpages.checked });
        //await apt['cms.text'].page(Page)['translate-all-langs'].post({ ifNeeded: inps.if_needed.checked, subpages: inps.subpages.checked });
        alert('translated texts: '+result.count);
        if (result.fail) alert('not allowed on '+result.fail+' pages');
        done();
        result.count && location.reload();
    });
    el.append(fragment);
});
