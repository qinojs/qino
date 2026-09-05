const w = globalThis;
const d = w.document;

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
      const events = this._getEvents(n);
      const i = events.indexOf(fn);
      if (i !== -1) events.splice(i, 1);
    }
  },
  trigger: function(ns, e) {
    for (const n of ns.split(' ')) {
      this._getEvents(n).forEach(fn => fn.call(this, e));
    }
  }
};


/* dom: single element from html; skips leading whitespace text nodes */
c1.dom = {
  el: html => {
    const tmpl = d.createElement('template');
    tmpl.innerHTML = html;
    return tmpl.content.firstElementChild;
  }
};

const dataEl = d.querySelector('#qino-data');
if (dataEl) {
  const data = JSON.parse(dataEl.textContent);
  for (const k in data) {
    if (w[k] === undefined) w[k] = data[k];
  }
}
//document.cookie = "q1_dpr=" + devicePixelRatio + "; path=/; SameSite=Strict" + (location.protocol === "https:" ? "; Secure" : "") + ";";
