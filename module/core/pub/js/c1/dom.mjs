/* Copyright (c) 2016 Tobias Buschor https://goo.gl/gl0mbf | MIT License https://goo.gl/HgajeK */

c1.dom = {};

const d = document;

c1.dom.fragment = function(html){
	const tmpl = d.createElement('template');
	tmpl.innerHTML = html;
	return tmpl.content;
};

/* custom el properties */
const poly = {
	c1Id: function() {
		return this.id ||= 'c1-gen-'+(autoId++);
	},
	c1FindAll: function(selector){
		return Array.from(this.querySelectorAll('#'+this.c1Id()+' '+selector));
	},
	c1Find: function(selector){
		return this.querySelector('#'+this.c1Id()+' '+selector);
	},
	/* (non standard) only ie supports native */
	removeNode: function(children) {
		if (children) return this.remove();
        this.replaceWith(...this.childNodes);
	},
	/* (non standard) */
	c1ZTop: function() {
		if (!this.parentNode) return;
		const children = this.parentNode.children;
        let i=children.length,
            maxZ=0,
            child,
            myZ=0;
        while (child=children[--i]) {
            let childZ = getComputedStyle(child).getPropertyValue('z-index') || 0;
			if (child.style.zIndex > childZ) childZ = child.style.zIndex;
			if (childZ === 'auto') childZ = 0;
            if (child === this) myZ = childZ;
			else maxZ = Math.max(maxZ, childZ);
        }
		if (myZ <= maxZ) this.style.zIndex = maxZ+1;
	}
};
let autoId = 0;
c1.ext(poly, Element.prototype, false, true);

// not standard
poly.closest = function(sel){ return this.parentNode.closest(sel); };
c1.ext(poly, Text.prototype, false, true);

c1.dom.ready = new Promise(res => document.addEventListener('DOMContentLoaded', res));

export default c1.dom;
