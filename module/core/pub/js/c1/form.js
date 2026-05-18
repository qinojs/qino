'use strict';
c1.form = {
    serializeObject: function(element) {
        var els;
        if (element instanceof Element) {
            els = element.elements || element.querySelectorAll('input, select, textarea');
            els = Array.prototype.slice.call(els);
            els.push(element);
        } else {
            els = element;
            els = Array.prototype.slice.call(els);
        }
        var object = Object.create(null);
        els.forEach(function(el){
            var value = c1.form.elementValue(el);
            if (value === void 0) return;
            var name = el.name;
            if (!name) return;
            var matches = name.match(/(^[^\[]+|\[[^\]]*\])/g);
            var active = object;
            for (var i=0, match; match=matches[i++];) { // walk path (item[xy][])
                if (i>1) match = match.replace(/(^\[|\]$)/g,'');
                if (matches.length === i) {
                    if (Array.isArray(active)) active.push(value);
                    else active[match] = value;
                } else if (!active[match]) {
                    active[match] = matches[i] === '[]' ? [] : Object.create(null);
                }
                active = active[match];
            }
        });
        return object;
    },
    elementValue: function(el){
        if (el.type === 'checkbox') return el.checked ? el.value : false;
        if (el.type === 'radio') {
            var form = el.form;
            var radios = document.getElementsByName(el.name);
            for (var i = 0, radio; radio = radios[i++];) {
                if (form !== radio.form) continue;
                if (!radio.checked) continue;
                return radio.value;
            }
            return;
        }
        return el.value;
    },
    fileDialog: function(options){ // todo: polyfill and use showOpenFilePicker()
        options ||= {};
        options = Object.assign({
            multiple: true,
            accept: '',
        },options);
        var inp = document.createElement('input');
        inp.type = 'file';
        inp.multiple = options.multiple;
        inp.accept   = options.accept;
        inp.style.cssText = 'position:absolute; left:-999px; opacity:0.01';
        document.body.append(inp); // ios: append to dom
        return new Promise(function(resolve, reject){
			inp.click(); // safari does not accept a delay, setTimeout needed for firefox anymore?
            setTimeout(function(){ // bug, change sometimes not fired without this timeout (chrome tested)
				inp.onchange = function(){
                    resolve(inp.files);
					inp.onchange = null;
                    inp.remove();
                }
			},99)
        });
    }
};


// helper triggers on blur if really changed // todo: c1OnFocusChecked
document.addEventListener('focusin', function(e){
    e.target.c1OnFocusValue = e.target.value;
    e.target.c1OnFocusChecked = e.target.checked;
}, true);
document.addEventListener('focusout', function(e){
    if (e.target.c1OnFocusValue === e.target.value && e.target.c1OnFocusChecked === e.target.checked) return;
    var event = new CustomEvent('c1-changed', {bubbles: true});
    e.target.dispatchEvent(event);
}, true);
