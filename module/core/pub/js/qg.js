/* Copyright (c) 2016 Tobias Buschor https://goo.gl/gl0mbf | MIT License https://goo.gl/HgajeK */
'use strict';
window.qg = {}; // needed?


window.Ask = function(obj, opt) {
	opt ||= {};
	Ask.trigger('start', obj);
	const data = new FormData();
	data.append('qgToken', qgToken);
	data.append('askJSON', JSON.stringify(obj));

	const url = opt.url || location.href;

	const controller = new AbortController();
	const signal = controller.signal;
	const abort = function(){ controller.abort(); };

	fetch(url, {
		method: 'POST',
		signal: signal,
		keepalive: !Ask.async,
		body: data,
	}).then(function(resp){
		return resp.json()
	}).then(function(res){
		Ask.trigger('complete', res); // first! loads head
		res?.script && eval(res.script); // toto, only used in cms.cont.shp3.paypement.paypal/qg.php
		opt.onComplete?.(res);
	}).catch(function(e){
		if (e.name === 'AbortError') return; // zzz if https://bugzilla.mozilla.org/show_bug.cgi?id=1583815
		if (beforeunloadDone) return; // requests are canceled when leaving the page
		console.warn(e.message);
	});
	return {abort};
};
c1.ext(c1.Eventer, Ask);

Ask.async = true;
let beforeunloadDone = false;
addEventListener('beforeunload',()=>{ // blur before unload (save)
	Ask.async = false;
	beforeunloadDone = true;
	//document.activeElement && document.activeElement.blur(); // ok? zzz
	document.activeElement?.blur(); // ok?
});

Ask.on('complete', function(res) {
	if (!res) return;
	function executeHTML(html){
		if (!html.match('<script')) return;
		const range = document.createRange();
		range.selectNode(document.head); // required in Safari
		const fragment = range.createContextualFragment(html);
		const div = document.createElement('div');
		div.append(fragment);
		document.documentElement.append(div)
		div.remove();
		//throw('unsave inline script');
	}
	if (res.head) {
		const range = document.createRange();
		range.selectNode(document.head); // required in Safari
		const fragment = range.createContextualFragment('<div>'+res.head+'</div>');
		fragment.querySelectorAll('script').forEach(s => s.async = false); // defer will not work
		document.head.append(fragment);
	}
	if (res.updateElements) {
		for (const selector in res.updateElements) {
			if (!res.updateElements.hasOwnProperty(selector)) continue;
			const html = res.updateElements[selector];
			const els = document.querySelectorAll(selector);
			for (let i=0, el; el=els[i++];) {
				el.innerHTML = html;
				executeHTML(html)
			}
		}
	}
	if (res.replaceElements) {
		for (const selector in res.replaceElements) {
			if (!res.replaceElements.hasOwnProperty(selector)) continue;
			const html = res.replaceElements[selector];
			const els = document.querySelectorAll(selector);
			for (let i=0, el; el=els[i++];) {
				el.outerHTML = html;
				executeHTML(html)
			}
		}
	}
});


window.$fn = function(fn) {
	function params() {
		const data = {fn: fn, args: [].slice.call(arguments), callb: undefined};
		$fn.stack.push(data);
		$fn.runCollected();
		return {
			run: function(callb) {
				data.callb = callb;
				return $fn.run();
			},
			then: function(callb) { // should return a Promise ...
				data.callb = callb;
			},
			setInitiator: function(initiator) { // better alternative?
				data.initiator = initiator;
				return this;
			}
		};
	}
	return params;
};
$fn.runCollected = function() { $fn.run(); }.c1Debounce(5);
$fn.stack = [];
$fn.run = function(cb, options) {
	options ||= {};
	const fns = $fn.stack;
	if (!fns.length) return;
	const request = Ask({ serverInterface: fns },{
		url: options.url,
		//url: options.url || location.href,
		onComplete: function(res) {
			if (!res) return;
			const results = res.serverInterface;
			if (!results) {
				console.warn('serverInterface no results. full response:'+JSON.stringify(res));
				return;
			}
			while (results.length) {
				const value = results.shift();
				const data  = fns.shift();
                data.callb?.(value);				
				$fn.trigger(data.fn, {arguments:data.args, returnValue:value, initiator:data.initiator});
				//data.value = value;
				//$fn.trigger('after-'+data.fn, data); // new?
			}
			cb?.(res.serverInterface)
		},
	});
	$fn.stack = [];
	return request;
};
c1.ext(c1.Eventer, $fn);

document.cookie = "q1_dpr=" + devicePixelRatio + "; path=/; SameSite=Strict; Secure;";
