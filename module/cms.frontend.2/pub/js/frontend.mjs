/* Copyright (c) 2016 Tobias Buschor https://goo.gl/gl0mbf | MIT License https://goo.gl/HgajeK */

import '../../../core/pub/js/c1/Placer.mjs';
import '../../../core/pub/js/qg/c1Combobox.mjs';
import '../../../core/pub/js/qg/fileHelpers.mjs';
import '../../../core/pub/js/Rte/index.mjs';
import '../../../core/pub/js/c1/fix/contextMenu.mjs';
import '../../../core/pub/js/c1/contextMenu.mjs';

import './rte.mjs';
import './contextMenu.mjs';
import './ddConts.mjs';
import './dropPasteHelper.mjs';
import './dropPaste.mjs';
import { t, apt } from '../../../core/pub/js/qino.js';

const Page = globalThis.qino?.cms?.nodeId;

cms.frontend2 = {};

/* cms.element? */
cms.contPos = function(el) {
	if (el.cmsContPos) return el.cmsContPos;
	if (!(this instanceof cms.contPos)) return new cms.contPos(el);
	el.cmsContPos = this;

	this.el = el;
	this.pid = el.getAttribute('qcms-id'); // used
	el.addEventListener('mouseleave',this.unmarkDelay.bind(this));
};
Object.assign(cms.contPos, c1.Eventer);

cms.contPos.prototype = {
	isDraggable() {
		if (this.el.classList.contains('-draggable')) return true;
		const p = this.el.parentNode;
		return p.hasAttribute('qcms-edit') && p.hasAttribute('qcms-drop');
	},
	mark(e) {
		const _ = cms.contPos;
		e?.stopPropagation(); // verschachtelt
		_.active?.unmark();
		//_.active && _.active.unmark();
		if (_.moving || _.active === this /*|| this.el.classList.contains('qgCMS-dropTarget')*/) { _.active = null; return; }
		_.active = this;
		this.el.classList.add('qgCmsMarked');
		cms.contPos.trigger('mark', this);
	},
	unmark() {
		clearTimeout(cms.contPos.outTimer);
		if (!cms.contPos.active) return;
		cms.contPos.active.el.classList.remove('qgCmsMarked');
		cms.contPos.active = null;
		cms.contPos.trigger('unmark', this);
	},
	unmarkDelay() {
		clearTimeout(cms.contPos.outTimer);
		cms.contPos.outTimer = setTimeout(this.unmark.bind(this),100);
	},
};
cms.contPos.moving = null;
cms.contPos.active = null;

function contMarkListener(e) {
	if (e.target.nodeType !== 1) return; // firefox on dragenter
	const target = e.target.closest('[qcms-edit]');
	target && cms.contPos(target).mark(e);
}
document.addEventListener('mouseover',contMarkListener);
document.addEventListener('dragenter',contMarkListener);
document.addEventListener('mousedown',contMarkListener);

cms.cont = function(id) {
	if (cms.cont.all[id]) return cms.cont.all[id];
	if (!(this instanceof cms.cont)) return new cms.cont(id);
	cms.cont.all[id] = this;
	this.id = id;
};
Object.assign(cms.cont, c1.Eventer);

cms.cont.prototype = {
	upload(File, complete, replace) {
		const event = Object.assign({}, c1.Eventer);
		event.pid = this.id;
		event.File = File;
		const progress = function(e) {
			event.trigger('progress', e);
		};
		const wrapComplete = function(res) {
			res = JSON.parse(res);
			res.error && alert(res.error);
			complete && setTimeout(function(){ complete(res); }, 700); // firefox problem?
			event.trigger('complete', res);
		};
		qgfileUpload(File, 'cmsPageFile', {
			url: location.pathname+'?cmspid='+this.id+'&replace='+(replace||''),
			progress: progress,
			complete: wrapComplete
		});
		cms.cont.trigger('upload', event);
	},
	async addPosition(){
		const res = await apt.cms.node(this.id).html.get();
		loadCallback({ html: res });
	}
};
cms.cont.all = {};
cms.cont.add = mod => apt.cms.node(Page).contents.post({ module: mod }).then(loadCallback);

function loadCallback(res){
	setTimeout(async ()=>{ // html possibility has content-script that needs header-script to be executed first
		const html = typeof res.html === 'string' ? res.html : res.id ? await apt.cms.node(res.id).html.get() : '';
		const el = c1.dom.fragment(html).firstElementChild;
		if (!el) return console.warn('cms.cont.add: no html', res);
		cms.contPos(el);
		cms.contPos.dd.start(el); // todo. what todo?
		el.style.top = '130px';
		el.style.left = '130px';
	});
}

/* element menu */
document.addEventListener('DOMContentLoaded',()=>{

	const p = cms.contPos;
	const menu = c1.dom.fragment(
		'<div id=qgCmsContPosMenu>'+
		    '<div class=-opts title="Einstellungen">'+
                '<svg width="24" height="24" viewBox="0 0 24 24"><path d="M19.14 12.94c.04-.3.06-.61.06-.94c0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.488.488 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6s3.6 1.62 3.6 3.6s-1.62 3.6-3.6 3.6z"></path></svg>'+
            '</div>'+
		    '<div class=-drag title="Verschieben">'+
                '<svg width="24" height="24" viewBox="0 0 24 24"><path d="M11 18c0 1.1-.9 2-2 2s-2-.9-2-2s.9-2 2-2s2 .9 2 2zm-2-8c-1.1 0-2 .9-2 2s.9 2 2 2s2-.9 2-2s-.9-2-2-2zm0-6c-1.1 0-2 .9-2 2s.9 2 2 2s2-.9 2-2s-.9-2-2-2zm6 4c1.1 0 2-.9 2-2s-.9-2-2-2s-2 .9-2 2s.9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2s2-.9 2-2s-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2s2-.9 2-2s-.9-2-2-2z"></path></svg>'+
            '</div>'+
		    '<div class=-mod  title="Module"></div>'+
		'</div>').firstChild;
	document.body.append(menu);
	menu.drag = menu.querySelector('.-drag');
	menu.mod  = menu.querySelector('.-mod');
	menu.opts = menu.querySelector('.-opts')
	menu.opts.addEventListener('click', () => {
		cms.cont.active = p.active.pid;
		cms.panel.sidebar.set('settings');
	})
	menu.addEventListener('mouseenter', e => p.active?.mark(e) )
	menu.addEventListener('mouseleave', e => p.active?.unmarkDelay(e) )
	menu.addEventListener('click',     e => e.stopPropagation() );
	menu.addEventListener('mousedown', e => e.stopPropagation() );

	const trash = c1.dom.fragment(
		'<div id=qgCmsContTrash>'+
		'	<svg width="50" height="60" viewBox="0 -5 26 30">'+
		'	  <path class="-lis" d="M18.902 1.194h-1.21C17.368.494 16.66 0 15.843 0H9.727c-.818 0-1.525.493-1.85 1.194h-1.21c-2.242 0-4.076 1.835-4.076 4.078H22.98c0-2.242-1.833-4.078-4.076-4.078z"/>'+
		'	  <path d="M3.83 21.988c0 1.97 1.612 3.582 3.583 3.582H18.16c1.97 0 3.58-1.612 3.58-3.582V6.466H3.83v15.522zm12.537-11.94c0-.66.535-1.194 1.194-1.194s1.194.535 1.194 1.194v11.94c0 .66-.534 1.193-1.193 1.193s-1.193-.534-1.193-1.192v-11.94zm-4.775 0c0-.66.534-1.194 1.194-1.194s1.194.535 1.194 1.194v11.94c0 .66-.534 1.193-1.194 1.193s-1.194-.534-1.194-1.192v-11.94zm-4.777 0c0-.66.534-1.194 1.193-1.194.66 0 1.194.535 1.194 1.194v11.94c0 .66-.534 1.193-1.194 1.193-.66 0-1.193-.534-1.193-1.192v-11.94z"/>'+
		'	</svg>'+
		'</div>', 'text/html').firstChild;
	document.body.append(trash);

	/* drag drop */
	const dd = new cms.contDrag();
	cms.contPos.dd = dd;
	dd.on('start',e=>{
		const el = e.target;
		dd.targets = document.querySelectorAll('[qcms-drop][qcms-edit], #qgCmsContTrash');
		document.querySelectorAll('[qcms-drop]').forEach(el=>el.classList.add('dropTarget'))
		p.moving = true;
		menu.style.display = 'none';
		el.classList.add('-moving');
		trash.classList.add('-dropTarget');
		c1.zTop(trash);
	})
	dd.on('change',e=>{
		trash.classList[[(e.target.id==='qgCmsContTrash'?'add':'remove')]]('-full');
	})
	dd.on('stop',el=>{
		document.querySelectorAll('[qcms-drop]').forEach(el=>el.classList.remove('dropTarget'))
		p.moving = null;
		el.classList.remove('-moving');
		if (!cms.el.nid(el.parentNode)) { // trash
			apt.cms.node(cms.el.nid(el)).delete();
		} else {
			const next = el.nextElementSibling ? cms.el.nid(el.nextElementSibling) : null;
			apt.cms.node(cms.el.nid(el.parentNode))["insert-before"].put({ id: String(cms.el.nid(el)), before: next ? String(next) : undefined });
		}
		trash.classList.remove('-dropTarget');
	})

	let startX, startY, ddEl;
	function move(e) {
		if (e.ctrlKey) {
			const pid = cms.el.nid(ddEl);
			apt.cms.node(pid).copy.post().then(({ id }) => {
				cms.cont(id).addPosition();
			});
		} else {
			if (Math.max( Math.abs(startX-e.clientX), Math.abs(startY-e.clientY) ) < 6) return;
			dd.start(ddEl, e);
		}
		up();
	}
	function up() {
		document.removeEventListener('mousemove', move);
		document.removeEventListener('mouseup', up);
	}
	menu.addEventListener('mousedown', e=>{
		if (!cms.contPos.active.isDraggable()) return;
		ddEl   = cms.contPos.active.el;
		startX = e.clientX;
		startY = e.clientY;
		document.addEventListener('mousemove', move);
		document.addEventListener('mouseup', up);
		e.preventDefault();
	})
	//let Placer = new c1.Placer(menu, {x:'prepend',y:'before', margin:{top:-.4,left:4,bottom:1,right:0} });/* firefox: top:-.4 */
	const Placer = new c1.Placer(menu, {x:'prepend',y:'before', margin:{top:1,left:4,bottom:1,right:0} });
	cms.contPos.on('mark', obj=>{
		menu.style.display = 'flex'; // todo
		const isDraggable = obj.isDraggable(),
			mod     = obj.el.getAttribute('qcms-mod') ?? '';
		Placer.follow(obj.el);

		menu.mod.innerHTML = mod.replace(/^cont\./,'');
		menu.mod.setAttribute('title',mod+' ('+obj.pid+')');
		menu.drag.style.display = isDraggable ? 'block' : 'none';
		menu.opts.style.display = obj.el.hasAttribute('qcms-edit') ? 'block' : 'none';
		menu.style.cursor = (isDraggable?'move':'default');

		if (obj.el.hasAttribute('qcms-offline')) {
			menu.mod.append(c1.dom.fragment('<span style="animation:qgcms_fadeInOut .4s linear alternate infinite; font-family:qg_cms; font-size:1.2em; line-height:.2; display:inline-block; margin-left:.5em"> &#xe901;</span>'))
		}
		menu.style.backgroundColor = getComputedStyle(obj.el)['outline-color'];
		c1.zTop(menu);
	});
	cms.contPos.on('unmark', () => menu.style.display = 'none' );
	setTimeout(() => document.activeElement.blur());
	globalThis.qino?.cms?.clipboard && import('./frontend2/clipboard.mjs').then(()=>cms.frontend2.clipboard(globalThis.qino.cms.clipboard));
});

cms.console = {
	show(msg, type) {
		const el = this.el();
		el.classList.add('-active');
		el.setAttribute('data-type',type);
		c1.zTop(el);
		el.firstElementChild.textContent = msg;
		clearTimeout(this.timeout);
		this.timeout = setTimeout(()=>el.classList.remove('-active'), 2200);
		setTimeout(()=>el.classList.add('-new')   , 1);
		setTimeout(()=>el.classList.remove('-new'), 100);
	},
	el() {
		let el = document.getElementById('cmsConsole');
		if (!el) {
			document.body.insertAdjacentHTML('beforeend',
			'<div id=cmsConsole class="qgCMS"><div class=-msg></div></div>');
			el = document.getElementById('cmsConsole');
		}
		return el;
	}
};

apt.addEventListener('error', ({ detail }) => {
	cms.console.show(detail.error?.message || t`Fehler beim API-Aufruf`, 'error');
});

cms.frontend2.dialog = async (title,body,buttons)=>{
	await import('../../../core/pub/js/c1/dialog.mjs');
	const dialog = new c1.dialog({title,body,buttons,class:'qgCMS'});
	dialog.show();
	return dialog.element;
};

apt.on('PUT cms/txt/:id', ({ value }) => {
	if (value?.changed) cms.console.show(t`Der Text wurde gespeichert.`, 'info');
});

apt.on('PUT|PATCH|DELETE cms/node/:id/*', async ({ params: { id } }) => {
	cms.reloadNode(id);
});

// apt.on('PUT cms/node/:id/position', async ({ params: { id } }) => {
// 	return;
// 	if (parseInt(id) == window.Page) {
// 		const res = await apt.cms.node(id).html.get();
// 		document.querySelector('.-pid' + id).outerHTML = res;
// 	} else {
// 		document.querySelectorAll('.-pid' + id).forEach(el => el.remove());
// 		const parent = document.querySelector('.-pid' + id)?.closest('.qgCmsPage');
// 		if (parent) {
// 			const pid = cms.el.nid(parent);
// 			const res = await apt.cms.node(pid).html.get();
// 			document.querySelector('.-pid' + pid).outerHTML = res;
// 		}
// 	}
// });

import("./browserCheck.js");
