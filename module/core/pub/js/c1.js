!function(w,d) { 'use strict';

w.c1 ||= {};


/* Waits for the execution of the function (min) and then executes the last call, but waits maximal (max) millisecunds.
*  If the function-scope changes, the function executes immediatly (good for event-delegation)
*/
Function.prototype.c1Debounce ||= function(options) {
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
        this.apply(inst, args);
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


const dataEl = d.querySelector('script[type="json/c1"]');
if (dataEl) {
	const data = JSON.parse(dataEl.textContent);
	for (const k in data) {
		if (w[k] === undefined) w[k] = data[k];
	}
}

}(globalThis,document);

document.cookie = "q1_dpr=" + devicePixelRatio + "; path=/; SameSite=Strict" + (location.protocol === "https:" ? "; Secure" : "") + ";";
