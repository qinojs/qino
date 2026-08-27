/* Copyright (c) 2016 Tobias Buschor https://goo.gl/gl0mbf | MIT License https://goo.gl/HgajeK */
!function(){ 'use strict';

var listeners = [],
    //root = document.documentElement,
    root = document,
    Observer;

c1.onElement = function(selector, options/*, disconnectedCallback*/) {
	if (typeof options === 'function') {
		options = { parsed:options }
	}
    var listener = {
        selector: selector,
		immediate: options.immediate,
        //disconnectedCallback: disconnectedCallback,
        elements: new WeakSet(),
    };
	if (options.parsed) {
    	listener.parsed = function(el){
			requestAnimationFrame(function(){
				options.parsed(el);
			});
		}
	}
	try {
	    var els = root.querySelectorAll(listener.selector), i=0, el;
  } catch {
		console.error('invalid selector: "'+listener.selector+'"');
		return;
	}
    while (el = els[i++]) {
        listener.elements.add(el);
        listener.parsed    && listener.parsed.call(el, el);
        listener.immediate && listener.immediate.call(el, el);
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
    var i=0, el, els = [];
    target && target.matches(listener.selector) && els.push(target);
    if (loaded) { // ok? check inside node on innerHTML - only when loaded
        Array.prototype.push.apply(els, (target||root).querySelectorAll(listener.selector));
    }
    while (el = els[i++]) {
        if (listener.elements.has(el)) continue;
        listener.elements.add(el);
        //listener.connectedCallback.call(el, el);
        listener.parsed    && listener.parsed.call(el, el);
        listener.immediate && listener.immediate.call(el, el);
    }
}
function checkListeners(inside) {
    var i=0, listener;
    while (listener = listeners[i++]) checkListener(listener, inside);
}
function checkMutations(mutations) {
    var j=0, i, mutation, nodes, target;
    while (mutation = mutations[j++]) {
        nodes = mutation.addedNodes, i=0;
        while (target=nodes[i++]) target.nodeType === 1 && checkListeners(target);
    }
}

var loaded = false;
document.addEventListener('DOMContentLoaded',function(){
    loaded = true;
});

}();
