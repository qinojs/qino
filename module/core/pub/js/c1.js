/* Copyright (c) 2016 Tobias Buschor https://goo.gl/gl0mbf | MIT License https://goo.gl/HgajeK */
!function(w,d) { 'use strict';
if (w.c1) return // zzz if its a module


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

// c1Use
const CALLBACKS = 'pseudosymbol_&/%f983';
w.c1Use = function (prop_or_opts, cb) {
	const scope = prop_or_opts.scope || this || self;
	const prop = prop_or_opts.property || prop_or_opts;
    if (prop in scope && scope[prop] !== undefined) { // loadet? // (test if it is the depencency setter)
    	cb?.call(scope, scope[prop]);
		return scope[prop];
    }
	const callbacks = scope[CALLBACKS] ||= {};
	if (callbacks[prop] && cb) { // is it loading? (and async zzz)
	    callbacks[prop].push(cb);
	} else { // load!
		const src = (prop_or_opts.from || scope.c1UseSrc) + '/' +prop;
		callbacks[prop] = [cb];
		const onload = e => {
            function runCallbacks(){
                const object = c1Use.able(scope, prop);
				if (e.type === 'error') object.c1UseFailed = true;
				//object.c1UseSrc = src; // neu. why? ist von c1Use.able bereits gesetzt !?
                let fn;
            	while (fn = callbacks[prop].shift()) fn.call(scope, object);
            }
            if (prop in scope || prop_or_opts.from) {
                runCallbacks();
            } else {
                // script geladen, aber darin wurde die property noch nicht gesetzt
                Object.defineProperty(scope, prop, {
                    set(value){
                        delete this[prop];
                        this[prop] = value;
                        setTimeout(runCallbacks);
                    },
                    configurable: true
                });
            }
        };
		loadScript(src+'.js', onload, onload);
	}
};
/* multiple and path
 * extend c1Use so it can have an array as first arguments
 * */
c1Use = function (use) {
	return function (props, cb) {
		let scope = this || self;
		if (!scope.c1UseSrc) { throw new Error("c1Use: the Object needs a c1UseSrc property!"); }
        if (Array.isArray(props)) {
        	const returns = [];
        	let counter = 0;
        	props.forEach((prop, index) => {
        		c1Use.call(scope, prop, res => {
        			counter++;
        			returns[index] = res;
        			if (props.length === counter) cb.apply(scope, returns);
        		});
        	});
        } else if (typeof props === 'string') {
        	if (props.startsWith('/')) { // neu beta
        		const parts = props.match(/(.*)\/([^\/]*)\..+$/);
        		return use.call(scope, {from:parts[1], property:parts[2]}, cb);
        	} else {
                // parts ("jQuery.fn.velocity")
                const parts = props.split('.');
                const prop = parts.pop();
                for (const part of parts) {
                    c1Use.able(scope, part);
                    scope = scope[part];
                }
        		return use.call(scope, prop, cb);
        	}
        } else {
        	return use.call(scope, props, cb);
        }
	};
} (c1Use);

/* return Promise */
c1Use = function (use) {
	return function (props, cb) {
        const scope = this;
        return new Promise(resolve => {
            use.call(scope, props, (...args) => {
                cb?.apply(scope, args);
                resolve(args);
            });
        });
	};
} (c1Use);

/* make the object useable */
c1Use.able = function (obj, prop) {
    return Object.assign(obj[prop] ??= {}, {
        c1Use,
        c1UseSrc: obj.c1UseSrc + '/' + prop,
    });
};

function loadScript(path, cb, eb) {
    d.head.appendChild(Object.assign(d.createElement('script'), {
        async: false, src: path, onload: cb, onerror: eb,
    }));
}
if (!w.c1UseSrc) {
    const scripts = d.getElementsByTagName('script');
    w.c1UseSrc = scripts[scripts.length-1].getAttribute('src').replace(/[^\/]+$/,'');
}

c1Use.able(w,'c1');
c1Use.able(c1,'fix');

}(this,document);
