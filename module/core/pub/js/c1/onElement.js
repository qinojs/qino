/* Copyright (c) 2016 Tobias Buschor https://goo.gl/gl0mbf | MIT License https://goo.gl/HgajeK */
!function(){ 'use strict';

const listeners = [];
    //const root = document.documentElement;
const root = document;
let Observer;

c1.onElement = function(selector, options/*, disconnectedCallback*/) {
	if (typeof options === 'function') {
		options = { parsed:options }
	}
    const listener = {
        selector: selector,
		immediate: options.immediate,
        //disconnectedCallback: disconnectedCallback,
        elements: new WeakSet(),
    };
	if (options.parsed) {
    	listener.parsed = el => requestAnimationFrame(() => options.parsed(el));
	}
	let els;
	try {
	    els = root.querySelectorAll(listener.selector);
	} catch(e) {
		console.error('invalid selector: "'+listener.selector+'"');
		return;
	}
    for (const el of els) {
        listener.elements.add(el);
        listener.parsed?.call?.(el, el);
        listener.immediate?.call?.(el, el);
    }

    listeners.push(listener);
    if (!Observer) {
        Observer = new MutationObserver(checkMutations);
        Observer.observe(root, {
            childList: true,
            subtree: true
        });
    }
    checkListener(listener);
};
function checkListener(listener, target) {
    const els = [];
    target?.matches?.(listener.selector) && els.push(target);
    if (loaded) { // ok? check inside node on innerHTML - only when loaded
        els.push(...(target||root).querySelectorAll(listener.selector));
    }
    for (const el of els) {
        if (listener.elements.has(el)) continue;
        listener.elements.add(el);
        listener.parsed?.call?.(el, el);
        listener.immediate?.call?.(el, el);
    }
}
function checkListeners(inside) {
    for (const listener of listeners) checkListener(listener, inside);
}
function checkMutations(mutations) {
    for (const mutation of mutations) {
        for (const target of mutation.addedNodes) {
            target.nodeType === 1 && checkListeners(target);
        }
    }
}

let loaded = false;
document.addEventListener('DOMContentLoaded', () => { loaded = true; });

}();
