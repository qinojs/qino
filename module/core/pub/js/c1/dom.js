/* Copyright (c) 2016 Tobias Buschor https://goo.gl/gl0mbf | MIT License https://goo.gl/HgajeK */
!function() { 'use strict';
if (c1.dom) return; // zzz if its a module
c1.dom = {};

var d = document;

c1.dom.fragment = function(html){
	var tmpl = d.createElement('template');
	tmpl.innerHTML = html;
	return tmpl.content;
};

/* custom el properties */
var poly = {
	c1Id: function() {
		return this.id ||= 'c1-gen-'+(autoId++);
	},
	c1FindAll: function(selector){
		var elements = this.querySelectorAll('#'+this.c1Id()+' '+selector);
		return Array.from(elements);
	},
	c1Find: function(selector){
		return this.querySelector('#'+this.c1Id()+' '+selector);
	},
	/* (non standard) only ie supports native */
	removeNode: function(children) {
		if (children) return this.remove();
        var fragment = d.createDocumentFragment();
        while (this.firstChild) fragment.appendChild(this.firstChild);
        this.parentNode.replaceChild(fragment, this);
	},
	/* (non standard) */
	c1ZTop: function() {
		if (!this.parentNode) return;
		var children = this.parentNode.children,
            i=children.length,
            maxZ=0,
            child,
            myZ=0;
        while (child=children[--i]) {
            var childZ = getComputedStyle(child).getPropertyValue('z-index') || 0;
			if (child.style.zIndex > childZ) childZ = child.style.zIndex; // neu 5.16, computed after paint => check for real
			if (childZ === 'auto') childZ = 0;
            if (child === this) myZ = childZ;
			else maxZ = Math.max(maxZ, childZ);
        }
		if (myZ <= maxZ) this.style.zIndex = maxZ+1;
	}
};
var autoId = 0;
c1.ext(poly, Element.prototype, false, true);

// not standard
poly.closest = function(sel){ return this.parentNode.closest(sel); };
c1.ext(poly, Text.prototype, false, true);

c1.dom.ready = new Promise(function(res){document.addEventListener('DOMContentLoaded',res);});

}();
