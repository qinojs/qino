/* Copyright (c) 2016 Tobias Buschor https://goo.gl/gl0mbf | MIT License https://goo.gl/HgajeK */
!function() { 'use strict';

//console.warn('deprecated: focusIn.js use css focus-within instead');

c1.focusIn = {};
const d = document;

function onIn(e) {
    let el = e.target;
	while (el?.classList) {
		el.classList.add('c1-focusIn');
		el = el.parentNode;
	}
}
function onOut() {
    setTimeout(() => { // wait for next focus
        const active = d.activeElement;
        for (const before of d.querySelectorAll('.c1-focusIn')) {
            !before.contains(active) && before.classList.remove('c1-focusIn');
        }
    }, 0);
}
d.addEventListener('focusin' , onIn);
d.addEventListener('focusout', onOut);
Element.prototype.c1Focus = function() {
    console.error('Element.c1Focus() is deprecated', Error().stack);
    let el = this;
    do {
    	if (d.activeElement === el) break;
		el.classList.add('c1-focusIn');
		const candidate = el.parentNode;
		if (!candidate || !candidate.classList) break;
        el = candidate;
    } while (el.classList);
    // d.activeElement.blur(); // used? not good for contextmenu!
	this.focus();
};

}();
