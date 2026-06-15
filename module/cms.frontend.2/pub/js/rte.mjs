// todo? // externe Seiten http://github.com/codepo8/GooHooBi/blob/master/multisearch.html
//import '../../../core/pub/js/Rte/Rte.ui.items.mjs';

import '../../../core/pub/js/Rte/index.mjs';
import { apt } from '../../../core/pub/js/qino.js';

// scoped query helpers
const find    = (el, sel) => el.querySelector(':scope '+sel);
const findAll = (el, sel) => el.querySelectorAll(':scope '+sel);
const unwrap  = el => el.replaceWith(...el.childNodes); // remove element, keep its children

const urlRegexp = /^[a-zA-Z0-9-]{2,999}\.[a-z0-9]{2,10}/;
const mailRegexp = /^([a-zA-Z0-9_.-])+@(([a-zA-Z0-9-])+.)+([a-zA-Z0-9]{2,10})+$/;

const inp = c1.dom.fragment('<input placeholder=url spellcheck=false type=qgcms-page>').firstChild;
const end = () => {
	const el = Rte.element.closest('a');
	if (!el) return;

	const selection = getSelection(); // todo: WebKit has a bug where links forces the caret to go after the link when typing
	const range = document.createRange();
	range.selectNodeContents(el);
	selection.removeAllRanges();
	selection.addRange(range);
	selection.collapseToEnd();

	let v = inp.value;
	if (v.trim() === '') {
		unwrap(el);
		Rte.trigger('input');
		return;
	} else if (!isNaN(v)) {
		v = 'cmspid://'+v;
	} else if (mailRegexp.test(v)) {
		v = 'mailto:'+v;
	} else if (urlRegexp.test(v)) {
		v = 'http://'+v;
	}
	inp.value = v;
	el.setAttribute('href',v);

	if (/^https?:\/\//.test(v)) {
		el.setAttribute('rel','noopener');
	} else {
		el.removeAttribute('rel','noopener');
	}


	if (!el.hasAttribute('target')) {
		el.setAttribute('target', /^(cmspid|mailto)/.test(v) || v[0] === '#' ? '_self' : '_blank');
	}
	Rte.active?.focus(); // always false? needed?
	Rte.trigger('input');
};
inp.addEventListener('blur',end);
inp.addEventListener('keyup',e => e.key === 'Enter' && inp.blur() ); // todo, focus is still in the input

Rte.ui.setItem('LinkInput', {
	el: inp,
	enable: 'a, a > *',
	check(el) {
		el = el.closest('a');
		const v = el.getAttribute('href');
		if (v) inp.value = v;
	}
});

Rte.ui.setItem('Link', {
	click() {
		const cEl = Rte.element;
		const exists = cEl?.closest('a');
		if (exists) {
			unwrap(exists);
		} else {
			//let el = qgSelection.surroundContents(document.createElement('a')); // todo: selection on multiple elements
			const range = getSelection().c1GetRange();
			const el = document.createElement('a');
			el.append(range.extractContents());
			range.insertNode(el);
			qgSelection.toChildren(el);

			Rte.element = 0; // force rte-event "elementchange"!
			// set initial value
			inp.value = '';
			const txt = el.textContent.trim();
			if (/^http[^\s]+$/.test(txt) || urlRegexp.test(txt) || mailRegexp.test(txt)) {
				inp.value = txt;
				el.setAttribute('href',txt);
			} else {
				apt.cms.nodes.get({ q: txt }).then(res => {
					if (!res[0]) return;
					inp.value = txt;
					inp.dispatchEvent(new Event('input'));
				});
			}
			setTimeout(()=>{
				el.classList.add('qgRte_fakeSelection');
				inp.addEventListener('blur', () => el.classList.remove('qgRte_fakeSelection'), {once:true})
				inp.focus();
			},1); // todo: why timeout?
		}
	},
	check(el) { return el?.matches?.('a, a > *'); },
	shortcut: 'k'
});


const externMediaDialog = async function(txtEl,medias) {
	const pid = await cms.txtIdToPid( txtEl.getAttribute('cmstxt') );
	const dialog = document.createElement('dialog');
	dialog.innerHTML =
		'<form method=dialog style="display:flex; flex-flow:column; gap:1em">'+
			'<p style="margin:0">Which files do you want to copy to your server?</p>'+
			'<div class=-files style="display:flex; flex-flow:column"></div>'+
			'<menu style="display:flex; justify-content:flex-end; margin:0; padding:0">'+
				'<button value=done>done</button>'+
			'</menu>'+
		'</form>'+
		'<style>.cmsExtMediaHighlight {outline: 6px solid #fa0}</style>';
	const list = find(dialog, '.-files');
	for (const media of Object.values(medias)) {
		const label = c1.dom.fragment('<label><input type=checkbox checked> '+media.basename+'</label>').firstChild;
		label.addEventListener('mouseover', ()=> media.els.forEach(el=>el.classList.add('cmsExtMediaHighlight')) );
		label.addEventListener('mouseleave',()=> media.els.forEach(el=>el.classList.remove('cmsExtMediaHighlight')) );
		find(label, 'input').addEventListener('change', e => media.checked = e.currentTarget.checked);
		list.append(label);
	}
	dialog.addEventListener('click', e => e.target === dialog && dialog.close()); // backdrop
	dialog.addEventListener('close', () => {
		if (dialog.returnValue === 'done') for (const [uri,media] of Object.entries(medias)) {
			if (!media.checked) { media.els.forEach(el=>el.classList.add('externMedia')); continue; }
			apt.cms.node(pid).files.post({ file: uri }).then(v=>{
				if (!v.url) return;
				for (const el of media.els) el.setAttribute(el.hasAttribute('src')?'src':'href', v.url+'/'+media.basename);
				txtEl.dispatchEvent(new Event('input',{bubbles:true}));
				txtEl.focus();
			});
		}
		dialog.remove();
	});
	document.body.append(dialog);
	dialog.showModal();
}
const checkMedia = root => {
	const medias = {}; let has = false;
	for (const el of findAll(root, 'a, img')) {
		if (el.classList.contains('externMedia')) continue;
		for (const attr of ['src','href']) {
			if (!el.hasAttribute(attr)) continue;
			const uri = new URL(el[attr]);
			if (location.host === uri.host) continue;
			const ext = uri.pathname.replace(/.*\./,'');
			if (!ext) continue;
			if (el.tagName === 'IMG' || ['pdf','doc','xls','jpg','png','gif'].includes(ext)) {
				const media = medias[uri] ||= {els:[], basename:uri.pathname.replace(/.*\//,''), checked:true};
				media.els.push(el);
				has = true;
			}
		}
	}
	has && externMediaDialog(root,medias);
};
document.addEventListener('paste', e => {
	if (!e.target.contentEditable) return;
	const txtEl = e.target.closest('[cmstxt]');
	if (!txtEl) return;
	setTimeout(()=>checkMedia(txtEl));
});

/* dbfile */
document.addEventListener('qgResize',e=>{
	const el = e.target;
	if (!el.isContentEditable) return;
	if (el.tagName === 'IMG' && el.src.includes('dbFile/')) {
		const width = el.width;
		const height = el.height;

		el.setAttribute('loading','lazy');
        el.style.setProperty('--shape-outside-url', 'url("'+el.getAttribute('src')+'")');

		el.style.maxWidth = '100%';
		el.style.width = width+'px';
		el.style.height = 'auto';
		new dbFile(el).set('w',width).set('h',height).set('max', 0);
		el.setAttribute('width',width);
		el.setAttribute('height',height);
		if (el.style.display === 'inline-block') el.style.display = '';

		el.removeAttribute('draggable');
		el.closest('[contenteditable]').dispatchEvent(new Event('input', {bubbles:true})); // save
	}
});

// dbclick zoomer
addEventListener('dblclick', e => {
    const img = e.target;
    if (img.isContentEditable && img.tagName === 'IMG' && img.src.includes('/dbFile')) {
        e.stopPropagation();
        e.preventDefault();

        const zoomImg = new Image();
        const clip = {};
        zoomImg.src = img.src.replace(/([a-z]+)-([^\/]*)\//g,function(match, name, value) {
            switch (name) {
                case 'w': case 'h': case 'vpos': case 'hpos': case 'zoom':
                    clip[name] = parseFloat(value);
                    return '';
                default: return match;
            }
        });
        zoomImg.onload = () => {
            const Zoomer = new ImageZoomer(zoomImg);
            Zoomer.activate();
            const change = () => {
                const vpos = Zoomer.y / ( Zoomer.img.height - Zoomer.h ) || 0;
                const hpos = Zoomer.x / ( Zoomer.img.width  - Zoomer.w ) || 0;
                new dbFile(img).set( 'vpos', vpos*100 ).set( 'hpos', hpos*100 ).set( 'zoom', Zoomer.factor() );
				img.dispatchEvent(new Event('qgResize',{bubbles:true}));
            };
            Zoomer.on('change',c1.debounce(change, 500));
			const pos = img.getBoundingClientRect();
			const left = pos.left + scrollX;
	        const top  = pos.top  + scrollY;
            Zoomer.canvas.style.cssText = 'outline:3px solid red; cursor:move; position:absolute; top:'+top+'px; left:'+left+'px';
            Zoomer.setDimension( pos.width, pos.height );

            /* set clip */
            const f = clip.zoom || Math.min( Zoomer.img.height/Zoomer.ctx.height, Zoomer.img.width/Zoomer.ctx.width );
            Zoomer.w = pos.width  * f;
            Zoomer.h = pos.height * f;
            Zoomer.x = (clip.hpos/100) * (Zoomer.img.width  - Zoomer.w ) || 0;
            Zoomer.y = (clip.vpos/100) * (Zoomer.img.height - Zoomer.h ) || 0;

            Zoomer.draw();

            const deactivate = () => {
                Zoomer.canvas.remove();
                document.removeEventListener('mousedown', deactivate);
                change();
            };
            document.addEventListener('mousedown', deactivate);
        };
    }
});

class ImageZoomer {
	constructor(img) {
		this.x = 0;
        this.y = 0;
        this.w = 100;
        this.h = 100;
        this.f = 1;

		this.img = img;
        this.canvas = document.createElement('canvas');
        this.canvas.setAttribute('tabindex','0');
        this.ctx = this.canvas.getContext("2d");
        this.setDimension(img.width,img.height);
        document.body.append(this.canvas);
	}
	setDimension(w,h) {
        this.ctx.width = this.canvas.width = w;
        this.ctx.height = this.canvas.height = h;
    }
    factor() {
        return this.w / this.ctx.width;
    }
    activate() {
        this.canvas.addEventListener('wheel', e => {
            eventStop(e);
            const oldF = this.factor();
            let f = oldF * wheelIntervalToFaktor(e);
            f = Math.min( this.img.height/this.ctx.height, this.img.width/this.ctx.width,  f ); // limit
            f = Math.max(1,f);

            const offset = this.mouseOffsetCloserToCenter(e);

            // offset transformed to image
            this.x = oldF * offset.x + this.x;
            this.y = oldF * offset.y + this.y;

            this.w = this.ctx.width  * f;
            this.h = this.ctx.height * f;
            this.x -= this.w/2;
            this.y -= this.h/2;

            this.draw();
        });

		let mousePos = {};
        this.canvas.addEventListener('mousedown', e => {
            e.preventDefault();
            e.stopPropagation();
            mousePos = {x: e.pageX, y: e.pageY};
            document.addEventListener('mousemove', move);
            document.addEventListener('mouseup', up);
        });
        const move = (e) => {
            const f = this.factor();
            const diff = {x: mousePos.x - e.pageX, y: mousePos.y - e.pageY};
            mousePos = {x: e.pageX, y: e.pageY};
            this.w = this.ctx.width  * f;
            this.h = this.ctx.height * f;
            this.x += diff.x;
            this.y += diff.y;
            this.draw();
        }
        function up() {
            document.removeEventListener('mousemove', move);
            document.removeEventListener('mouseup', up);
        }
    }
    draw() {
        this.x = limit(this.x, 0, this.img.width  - this.w );
        this.y = limit(this.y, 0, this.img.height - this.h );
        this.ctx.clearRect(0, 0, this.ctx.width, this.ctx.height);
        this.ctx.drawImage(this.img, this.x, this.y, this.w, this.h, 0, 0, this.ctx.width, this.ctx.height);
        this.trigger('change');
    }
    mouseOffsetCloserToCenter(e) {
        // real offset on canvas
        const x = e.offsetX;
        const y = e.offsetY;
        return {
            x: ( x + 2*this.ctx.width  ) / 5, //(x+4*xhalbe durch 5)
            y: ( y + 2*this.ctx.height ) / 5
        };
    }
}
Object.assign(ImageZoomer.prototype, c1.Eventer);

/*******************************/
/* helpers *********************/
/*******************************/
function limit(number, min, max) {
	return Math.min(max, Math.max(number, min) );
}
let lastTime = 0;
function wheelIntervalToFaktor(e) {
	// intervall diff
    const time = e.timeStamp;
    let diff = time-lastTime;
	if (!e._eventChecked) {
        lastTime = time;
        e._eventChecked = true;
	}
	// faktor
	const max = 400;
	const min = 10;
	diff = limit(diff, min, max+min);
	let x = (diff - min) / max; // range from 1 to 0
	x = 1-x;
	x **= 3;
	x = 1-x;
	x = 0.7 + (0.3 * x); // range from 0.7 to 1.0;
	x = Math.min(x, 0.998);

	x = e.deltaY > 0 ? x : 1/x; // up or down?
	return x;
}
function eventStop(e) {
	e.stopPropagation();
	e.preventDefault();
}
