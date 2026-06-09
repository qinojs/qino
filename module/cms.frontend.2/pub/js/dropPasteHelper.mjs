/* Copyright (c) 2016 Tobias Buschor https://goo.gl/gl0mbf | MIT License https://goo.gl/HgajeK */
import './../../../core/pub/js/c1/NodeCleaner.mjs';
import { apt, ctx } from '../../../core/pub/js/qino.js';

// txt-id to page-id
const txtIds = {};
cms.txtIdToPid = async function(tid) {
	if (txtIds[tid]) return txtIds[tid];
	return txtIds[tid] = await apt.cms['node-id-from-txt-id'].get({ id: parseInt(tid) }).then(r => r.id);
};
// clean texts
cms.txtCleanElement = function(el,tid){
    if (el.tagName === 'IMG') el.setAttribute('loading','lazy');
    if (el.tagName === 'IMG' && el.src.match(/^data:/)) {
        cms.txtIdToPid(tid).then( pid => cms.imgToDbFile(el, pid) );
    }
    if (el.tagName === 'IMG' && el.src.match('dbFile/')) {
        const dim = () => {
            el.style.maxWidth = '100%';
            el.style.width = el.offsetWidth+'px';
            el.style.height = 'auto';
            el.style.setProperty('--shape-outside-url', 'url("'+el.getAttribute('src')+'")');
            el.setAttribute('width', el.offsetWidth);
            el.setAttribute('height', el.offsetHeight);
        };
        if (el.offsetWidth) dim();
        else if (el.complete) requestAnimationFrame(dim);
        else el.addEventListener('load', () => requestAnimationFrame(dim), { once: true });
    }
    if (el.src?.match?.('dbFile/')  && el.src .match(location.host)) { el.src  = ctx.appURL+el.src .replace(/.*dbFile\//,'dbFile/'); }
    if (el.href?.match?.('dbFile/') && el.href.match(location.host)) { el.href = ctx.appURL+el.href.replace(/.*dbFile\//,'dbFile/'); }
    el.removeAttribute('cmstxt');
    el.classList.remove('qgCmsCont', 'qgCmsPage');
};
cms.txtClean = function(el,tid) {
	el = el.data ? el.parentNode : el;
    el.querySelectorAll('*').forEach(function(el) {
        cms.txtCleanElement(el,tid);
	});
};
// text add file from fs
cms.txtAddFile = async function(txtEl, f) {
    const pid = await cms.txtIdToPid( txtEl.getAttribute('cmstxt') );
	const ph = fileGetPreview(f);
	const complete = function(r) {
		if (f.c1IsImage()) {
			const load = function() {
				const file = new dbFile(this);
				const max = txtEl.offsetWidth;
				ph.replaceWith(this);
				if (this.width > max) {
					const h = max / this.width * this.height;
					file.set('w',max); file.set('h',h); file.write();
				}
				qgSelection.toElement(this);
                img.dispatchEvent(new MouseEvent('mousedown',{bubbles:true})); // why
                img.dispatchEvent(new Event('qgResize',{bubbles:true}));
                img.onload = null;
			};
            const img = document.createElement('img');
            img.src = r.url;
            img.onload = load;
		} else {
            ph.style.opacity = '';
            ph.firstElementChild.href = r.url;
            ph.firstElementChild.innerHTML = r.url.replace(/.*\//,'');
		}
		txtEl.focus();
	};
	cms.cont(pid).upload(f,complete);
};

// img to dbfile
cms.imgToDbFile = function(img, pid, cb) {
	const complete = function(r) {
		const load = function() {
            img.removeEventListener('load',load);
			cb?.(img);
		};
        img.addEventListener('load',load);
        img.src = r.url;
	};
    img.c1ToBlob().then(blob => cms.cont(pid).upload(blob, complete));
};

function fileGetPreview(f) {
    let ph = null;
    if (f.c1IsImage()) {
        ph = c1.dom.fragment('<img style="max-width:101%; opacity:.6; filter:grayscale(1)">').firstChild;
        f.c1ToImage(ph);
    } else {
        ph = c1.dom.fragment('<span><a href="#" target=_blank> '+f.name+' </a></span>').firstChild;
    }
    const range = getSelection().getRangeAt(0);
    range.insertNode(ph);
    return ph;
}


cms.NodeCleanerConf_ForeignContent = {
	tags: {H1:1,H2:1,H3:1,H4:1,H5:1,H6:1,A:1,BR:1,HR:1,P:1,B:1,STRONG:1,IMG:1,DIV:1,TABLE:1,TR:1,TD:1,TH:1,TBODY:1,THEAD:1,SPAN:1,LI:1,UL:1,OL:1},
	tagsRemove: {'O:P':1,'STYLE':1,'SCRIPT':1,'META':1,'LINK':1,'TITLE':1},
	attributes: {src:1,target:1,href:1,alt:1,colspan:1,rowspan:1},
	//styles: {},
	//classes: {},
	removeEmptyElements: 1,
	removeUnusedElements: 1,
    removeNbsp: 1,
};

const Cleaner = new c1.NodeCleaner(cms.NodeCleanerConf_ForeignContent);

window.onPasteFormatNode = function(node) {
	Cleaner.cleanContents(node, true);
};

