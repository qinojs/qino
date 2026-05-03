/* Copyright (c) 2016 Tobias Buschor https://goo.gl/gl0mbf | MIT License https://goo.gl/HgajeK */

(function(){
	'use strict';
	if (window.cms) throw('cms.js already loaded!');
	window.cms = {};
	c1.ext(c1.Eventer, cms);

	cms.modConnected = {};

	cms.initCont = function(module, fn) {
		if (cms.modConnected[module]) return;
		cms.modConnected[module] = fn;
		const els = document.querySelectorAll('.qgCmsPage .-m-'+module.replace(/\./g,'-'));
		for (const el of els) {
			if (el.__cms_initialized) continue;
			fn(el);
			el.__cms_initialized = true;
		}
	};
	/* listen for new contents */
	c1.onElement('.qgCmsPage .qgCmsCont',function(el){  // inside qgCmsPage ok?
		if (el.__cms_initialized) return;
		var module = cms.el.module(el);
		var fn = cms.modConnected[module];
		if (fn) {
			fn(el);
			el.__cms_initialized = true;
		}
	});

	cms.el = {
		root(el){
			return el.closest('.qgCmsCont');
		},
		pid(el){
			const root = el.closest('.qgCmsCont');
			return root && root.className.replace(/.*-pid([0-9]+).*/, '$1');
		},
		module(el){
			const root = el.closest('.qgCmsCont');
			return root && root.className.replace(/.*-m-([^ ]+).*/, '$1').replace(/-/g, '.');
		}
	}
	// dbfile
	window.dbFile = function(el) {
		var elements = el.getAttribute('src').replace(/.*dbFile\//, '').split(/\//);
		this.el = el;
		this.name = elements.pop();
		this.id   = elements.shift();
		this.parts = {};
		for (var i=0, element; element = elements[i++];) {
			if (element === '') continue;
			var nv = element.split('-', 3);
			this.parts[nv[0]] = nv[1];
		}
	};
	window.dbFileUrl = function(url) {
		var elements = url.replace(/.*dbFile\//, '').split(/\//);
		this.name = elements.pop();
		this.id   = elements.shift();
		this.parts = {};
		for (var i=0, element; element = elements[i++];) {
			if (element === '') continue;
			var nv = element.split('-', 3);
			this.parts[nv[0]] = nv[1];
		}
	};
	dbFile.prototype = dbFileUrl.prototype = {
		get(part){
			return this.parts[part];
		},
		set(part, value){
			this.parts[part] = value;
			this.write();
			return this;
		},
		write(){
			this.el && this.el.setAttribute('src', this.toString());
		},
		toString(){
			var src = '';
			for (var part in this.parts) {
				src += '/'+part;
				var value = this.parts[part];
				if (value === undefined) continue;
				src += '-'+value;
			}
			return appURL + 'dbFile/' + this.id + src + '/' + this.name;
		}
	}
	// special inputs
	document.addEventListener('focus', function(e) {
		var input = e.target,
			lastRequest,
			box;
		if (input.tagName !== 'INPUT') return;
		if (input.getAttribute('type') === 'qgcms-page') {
			box = new c1Combobox(input);
			box.searchOptions = function(){
				lastRequest && lastRequest.abort();
				lastRequest = $fn('cms::searchPagesByTitle')(input.value, input.getAttribute('qgcms-filter')).run(box.setOptions.bind(box));
			};
		}
		if (input.getAttribute('type') === 'qgcms-file') {
			box = new c1Combobox(input);
			box.searchOptions = function(){
				lastRequest && lastRequest.abort();
				lastRequest = $fn('cms::searchFile')(input.value).run(box.setOptions.bind(box));
			};
		}
		box && box.onfocus(e);
	}, true);

	document.addEventListener('DOMContentLoaded',function(){
		// sync texts
		var d = document;
		d.body.addEventListener('keyup', function(e) {
			if (!e.target.hasAttribute('cmstxt')) return;
			var el = e.target,
				tid  = el.getAttribute('cmstxt'),
				lang = el.getAttribute('cmslang') || document.documentElement.lang,
				all = d.querySelectorAll('[cmstxt="'+tid+'"]'),
				v = isFormEl(el) ? el.value : el.innerHTML,
				i = 0, other;
			while (other = all[i++]) {
				if (el === other) continue;
				const itemlang = other.getAttribute('cmslang') || document.documentElement.lang;
				if (itemlang !== lang) continue;
				if (isFormEl(other)) {
					other.value = v;
				} else {
					other.innerHTML = v;
				}
			}
		}.c1Debounce(50));

		// save txts
		d.body.addEventListener('blur', saveTxt, true);
		d.body.addEventListener('input', saveTxt.c1Debounce(1600));
		function isFormEl(el) {
	    	return el.value !== undefined && el.tagName !== 'BUTTON';
	    }
		function cleanUpEl(el) {
	        if (isFormEl(el)) return;
	        var els = el.querySelectorAll('img'), i=0;
	        while (el=els[i++]) {
	            var src = el.getAttribute('src');
	            src.indexOf(location.origin) === 0 && el.setAttribute('src', src.replace(location.origin,''));
	        }
	    }
		function saveTxt(e) {
			if (!e.target.hasAttribute('cmstxt')) return;
			var el  = e.target;
			if (!el.isContentEditable && el.form === undefined) return;
			var tid = el.getAttribute('cmstxt');
			var lang = el.getAttribute('cmslang');
			cleanUpEl(el);
			var v = isFormEl(el) ? el.value : el.innerHTML;
			$fn('cms::setTxt')(tid,v,lang).run(); // run() before unload is done!!
		}

	});

})();
