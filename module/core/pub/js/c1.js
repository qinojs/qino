/* Copyright (c) 2016 Tobias Buschor https://goo.gl/gl0mbf | MIT License https://goo.gl/HgajeK */
!function(w,d) { 'use strict';
if (w.c1) return;


/* Waits for the execution of the function (min) and then executes the last call, but waits maximal (max) millisecunds.
*  If the function-scope changes, the function executes immediatly (good for event-delegation)
*/
Function.prototype.c1Debounce = function(options) {
	if (typeof options === 'number') options = {min:options, max:options*2};
	const fn = this;
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
RegExp.escape ||= function(text) {
    return text.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&");
};
Math.c1Limit = function(number,min,max) {
    return Math.min( Math.max( parseFloat(min) , parseFloat(number) ), parseFloat(max) );
};

w.c1 ||= {};

/* eventer */
c1.Eventer = {
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
	        Events.splice(Events.indexOf(fn), 1);
    	}
    },
	trigger: function(ns, e) {
        for (const n of ns.split(' ')) {
            this._getEvents(n).forEach(Event => Event.call(this, e));
    	}
    }
};
/* ext */
c1.ext = function (src, target, force, deep) {
    target ||= {};
    for (const k in src) {
    	if (!Object.hasOwn(src, k)) continue;
        if (force || target[k] === undefined) {
            target[k] = src[k];
        }
		if (!deep) continue;
		if (typeof k === 'string') continue;
		//if (typeof target[k] === 'string') continue; // todo
        c1.ext(src[k], target[k], force, deep);
    }
    return target;
};

const dataEl = d.querySelector('script[type="json/c1"]');
if (dataEl) {
	const data = JSON.parse(dataEl.textContent);
	c1.ext(data, w, false, true);
}

}(this,document);

document.cookie = "q1_dpr=" + devicePixelRatio + "; path=/; SameSite=Strict" + (location.protocol === "https:" ? "; Secure" : "") + ";";
