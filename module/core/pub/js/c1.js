!function(w,d) { 'use strict';

w.c1 ||= {};


/* Waits for the execution of the function (min) and then executes the last call, but waits maximal (max) millisecunds.
*  If the function-scope changes, the function executes immediatly (good for event-delegation)
*/
c1.debounce ||= function(fn, options) {
	if (typeof options === 'number') options = {min:options, max:options*2};
	let inst,
		args,
		timerMin = 0,
		timerMax = 0,
		triggered = true;
	const trigger = () => {
        triggered = true;
        clearTimeout(timerMax);
        clearTimeout(timerMin);
        timerMax = 0;
        fn.apply(inst, args);
    };
    const wrapped = function() {
        inst !== this && !triggered && trigger();
        triggered = false;
        inst = this;
        args = arguments;
        clearTimeout(timerMin);
        timerMin = setTimeout(trigger, options.min);
        !timerMax && options.max && (timerMax = setTimeout(trigger, options.max));
    };
    wrapped.trigger = function(){
        args = arguments;
        trigger();
    };
    return wrapped;
};

/* eventer */
c1.Eventer ||= {
    _getEvents : function(n) {
        this._Es ||= {};
        this._Es[n] ||= [];
        return this._Es[n];
    },
	on: function(ns, fn) {
    	for (const n of ns.split(' ')) this._getEvents(n).push(fn);
    },
	off: function(ns, fn) {
    	for (const n of ns.split(' ')) {
	        const Events = this._getEvents(n);
	        const i = Events.indexOf(fn);
	        if (i !== -1) Events.splice(i, 1);
    	}
    },
	trigger: function(ns, e) {
        for (const n of ns.split(' ')) {
            this._getEvents(n).forEach(fn => fn.call(this, e));
    	}
    }
};


/* dom: fragment builder + helpers */
c1.dom ||= {};
c1.dom.fragment = function(html){
	const tmpl = d.createElement('template');
	tmpl.innerHTML = html;
	return tmpl.content;
};
/* raise element's z-index above its siblings */
c1.zTop = function(el) {
	if (!el.parentNode) return;
	const children = el.parentNode.children;
	let i = children.length, maxZ = 0, child, myZ = 0;
	while ((child = children[--i])) {
		let childZ = getComputedStyle(child).getPropertyValue('z-index') || 0;
		if (child.style.zIndex > childZ) childZ = child.style.zIndex;
		if (childZ === 'auto') childZ = 0;
		if (child === el) myZ = childZ;
		else maxZ = Math.max(maxZ, childZ);
	}
	if (myZ <= maxZ) el.style.zIndex = maxZ+1;
};

// text nodes lack native closest; warn to find out if this polyfill is still used anywhere
Text.prototype.closest = function(sel){
	console.warn('Text.closest polyfill used', sel, this);
	return this.parentNode.closest(sel);
};


const dataEl = d.querySelector('script[type="json/c1"]');
if (dataEl) {
	const data = JSON.parse(dataEl.textContent);
	for (const k in data) {
		if (w[k] === undefined) w[k] = data[k];
	}
}

}(globalThis,document);

//document.cookie = "q1_dpr=" + devicePixelRatio + "; path=/; SameSite=Strict" + (location.protocol === "https:" ? "; Secure" : "") + ";";
