/* Copyright (c) 2016 Tobias Buschor https://goo.gl/gl0mbf | MIT License https://goo.gl/HgajeK */
import { apt } from '../../../core/pub/js/apt.js';

const cms = {};
c1.ext(c1.Eventer, cms);

cms.modConnected = {};

cms.initCont = function(module, fn) {
	if (cms.modConnected[module]) return;
	cms.modConnected[module] = fn;
	for (const el of document.querySelectorAll('.qgCmsPage .-m-'+module.replace(/\./g,'-'))) {
		if (el.__cms_initialized) continue;
		fn(el);
		el.__cms_initialized = true;
	}
};

c1.onElement('.qgCmsPage .qgCmsCont', function(el) {
	if (el.__cms_initialized) return;
	const module = cms.el.module(el);
	const fn = cms.modConnected[module];
	if (fn) { fn(el); el.__cms_initialized = true; }
});

cms.el = {
	root(el)   { return el.closest('.qgCmsCont'); },
	pid(el)    { const root = el.closest('.qgCmsCont'); return root && root.className.replace(/.*-pid([0-9]+).*/, '$1'); },
	module(el) { const root = el.closest('.qgCmsCont'); return root && root.className.replace(/.*-m-([^ ]+).*/, '$1').replace(/-/g, '.'); },
};

// dbFile
const proto = {
	get(part)        { return this.parts[part]; },
	set(part, value) { this.parts[part] = value; this.write(); return this; },
	write()          { this.el?.setAttribute('src', this.toString()); },
	toString() {
		let src = '';
		for (const part in this.parts) {
			src += '/' + part;
			if (this.parts[part] !== undefined) src += '-' + this.parts[part];
		}
		return appURL + 'dbFile/' + this.id + src + '/' + this.name;
	},
};

class DbFile {
	constructor(el) {
		const parts = el.getAttribute('src').replace(/.*dbFile\//, '').split('/');
		this.el   = el;
		this.name = parts.pop();
		this.id   = parts.shift();
		this.parts = {};
		for (const s of parts) { if (s) { const [k, v] = s.split('-'); this.parts[k] = v; } }
	}
}
class DbFileUrl {
	constructor(url) {
		const parts = url.replace(/.*dbFile\//, '').split('/');
		this.name = parts.pop();
		this.id   = parts.shift();
		this.parts = {};
		for (const s of parts) { if (s) { const [k, v] = s.split('-'); this.parts[k] = v; } }
	}
}
Object.assign(DbFile.prototype, proto);
Object.assign(DbFileUrl.prototype, proto);

// apt: special inputs
function abortableCombobox(input, apiFn) {
	const box = new c1Combobox(input);
	let last;
	box.searchOptions = () => {
		last?.abort();
		last = new AbortController();
		apiFn({ q: input.value }, { signal: last.signal }).then(box.setOptions.bind(box));
	};
	return box;
}

document.addEventListener('focus', e => {
	const input = e.target;
	if (input.tagName !== 'INPUT') return;
	let box;
	if (input.getAttribute('type') === 'qgcms-page') box = abortableCombobox(input, apt.cms.nodes.get.bind(apt.cms.nodes));
	if (input.getAttribute('type') === 'qgcms-file') box = abortableCombobox(input, apt.cms.files.get.bind(apt.cms.files));
	box?.onfocus?.(e);
}, true);

// apt: save texts
function isFormEl(el) { return el.value !== undefined && el.tagName !== 'BUTTON'; }
function cleanUpEl(el) {
	if (isFormEl(el)) return;
	el.querySelectorAll('img').forEach(img => {
		const src = img.getAttribute('src');
		if (src?.startsWith(location.origin)) img.setAttribute('src', src.replace(location.origin, ''));
	});
}
function saveTxt(e) {
	if (!e.target.hasAttribute('cmstxt')) return;
	const el = e.target;
	if (!el.isContentEditable && el.form === undefined) return;
	cleanUpEl(el);
	apt.cms.txt(parseInt(el.getAttribute('cmstxt'))).put({ value: isFormEl(el) ? el.value : el.innerHTML, lang: el.getAttribute('cmslang') });
}
document.addEventListener('DOMContentLoaded', () => {
	document.body.addEventListener('blur', saveTxt, true);
	document.body.addEventListener('input', saveTxt.c1Debounce(1600));
});

cms.reloadNode = (pid) => {
	return apt.cms.node(pid).html.get().then(html => {
		document.querySelectorAll('.-pid' + pid).forEach(el => el.outerHTML = html);
	});
};

cms.reloadPart = (pid, part, vars) => {
	return apt.cms.node(pid).html.part(part).get(vars ? { vars } : undefined).then(html => {
		document.querySelectorAll('.-pid' + pid + ' [cms-part="' + part + '"]').forEach(el => {
			if (el.closest('.qgCmsCont').matches('.-pid' + pid)) el.innerHTML = html;
		});
	});
};

// global exports for legacy scripts
globalThis.cms      = cms;
globalThis.dbFile   = DbFile;
globalThis.dbFileUrl = DbFileUrl;
