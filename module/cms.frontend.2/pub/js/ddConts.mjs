/* Copyright (c) 2016 Tobias Buschor https://goo.gl/gl0mbf | MIT License https://goo.gl/HgajeK */
let active, dropCont, dropBefore, oldCss, ghost = document.createElement('div');
ghost.style.cssText = 'background:#ff5; outline:#ff5 3px solid; min-height:8px; margin:2px; box-shadow:0 0 30px 3px rgba(0,0,0,.8); min-width:20px; z-index:999; position:relative; overflow:hidden; opacity:.9';

cms.contDrag = function() {
	const self = this;
	const move = function(e) {
		active.style.left = e.clientX - 40 + 'px';
		active.style.top  = e.clientY + 20 + 'px';
		updatePosition(e, self);
	};

	const updatePosition = c1.debounce(function(e, self){
		if (!active) return;
		const newDropCont   = getNearestElement2(e, self.targets, active);
		const newDropBefore = getBeforeElement(e,newDropCont);
		if (dropCont !== newDropCont || dropBefore !== newDropBefore) {
			dropCont   = newDropCont;
			dropBefore = newDropBefore;
			dropCont.insertBefore(ghost,dropBefore);
			self.trigger('change',{target:dropCont,before:dropBefore});
		}
	}, 40);

	function up() {
		moveToTargetEffect(active);
		if (!dropCont) return; // neu
		ghost.remove();
		dropCont.insertBefore(active,dropBefore);
		active.style.cssText = oldCss;
		active.style.opacity = 0; // moveToTargetEffect!!
		document.removeEventListener('mousemove',move);
		document.removeEventListener('mouseup',up);
		self.trigger('stop',active);
		dropCont   = 0;
		dropBefore = 0;
		active = null;
	}

	this.start = (el, e)=>{
		document.addEventListener('mousemove',move);
		document.addEventListener('mouseup',up);
		self.trigger('start',{target:el, originalEvent:e});
		active = el;
		oldCss = active.style.cssText;
		active.style.position  = 'fixed';
		c1.zTop(active);
		document.body.append(active);
		e && move(e);
	};

};
cms.contDrag.prototype = c1.Eventer;

/*
function getNearestElement(e, els, notInside) {
	let winner, winner2, min=null;
	for (let i = els.length, el; el = els[--i];) {
		if (notInside?.contains(el)) continue;
		var r = el.getBoundingClientRect();
		var elMin = null;
		var xmin = Math.min(Math.abs(r.left - e.clientX), Math.abs(r.right - e.clientX));
		var ymin = Math.min(Math.abs(r.top - e.clientY), Math.abs(r.bottom - e.clientY));
		if (e.clientY < r.top || e.clientY > r.bottom || e.clientX < r.left || e.clientX > r.right) { // is outside
			if (e.clientY > r.top && e.clientY < r.bottom) { // in Y
				elMin = xmin;
			} else if (e.clientX > r.left && e.clientX < r.right) { // in X
				elMin = ymin;
			} else {
				elMin = Math.sqrt(xmin*xmin+ymin*ymin);
			}
		} else { // is inside
			elMin = Math.min(xmin,ymin) / 50; // inside is 50x better!
		}
		if (min === null || elMin < min) {
			min = elMin;
			winner2 = winner;
			winner = el;
		}
	}
	return winner;
}
*/



function elementDistance(el,x,y) {
	let distance = null;
	const rect = el.getBoundingClientRect();
	const distanceX = Math.min(Math.abs(rect.left - x), Math.abs(rect.right - x));
	const distanceY = Math.min(Math.abs(rect.top - y), Math.abs(rect.bottom - y));
	const isInside = !(y < rect.top || y > rect.bottom || x < rect.left || x > rect.right);
	if (isInside) {
		distance = Math.min(distanceX,distanceY); // 0?
	} else {
		if (y > rect.top && y < rect.bottom) { // in Y
			distance = distanceX;
		} else if (x > rect.left && x < rect.right) { // in X
			distance = distanceY;
		} else {
			distance = Math.sqrt(distanceX*distanceX + distanceY*distanceY);
		}
	}
	return {
		distance,
		distanceX,
		distanceY,
		isInside,
	};
}
function elementDistances(e, els) {
	const items = [];
	for (const element of els) {
		const distances = elementDistance(element, e.clientX, e.clientY);
		let distance = distances.distance;
		if (distances.isInside) distance /= 50; // inside is 50x better (nearer)!
		items.push({
			element,
			distances,
			distance,
		});
	}
	return items.sort((a, b) => a.distance - b.distance);
}
function getNearestElement2(e, els, notInside) {
	els = Array.prototype.filter.call(els, el => !notInside.contains(el) )
	const items = elementDistances(e, els);
	return items[0]?.element;
}
/*
function getBeforeElement(e, inside) {
	const children = Array.from(inside.children).filter(item=>{ return item !== active && item !== ghost });
	const nearest = getNearestElement2(e, children);
	if (!nearest) return null;

	const rect = nearest.getBoundingClientRect();
	const x = e.clientX
	const y = e.clientY;

	const center = {
		x: rect.left + (rect.width/2),
		y: rect.top + (rect.height/2),
	}
	const isBefore = y < center.y || x < center.x;
	return isBefore ? nearest : nearest.nextElementSibling;
}
*/

/* testen: https://gemini.google.com/app/d742aa7e9c82dddd?hl=de */
function getBeforeElement(e, el) {
	let min=null, winner;
	if (el.children.length) {
		for (let i=0,child; (child=el.children[i++]);) {
			if (child === active || child === ghost) continue;
			const pos = child.getBoundingClientRect();
			const x = pos.left+(pos.width/2);
			const y = pos.top+(pos.height/2);
			const diffX = (e.clientX-x)*1;
			const diffY = (e.clientY-y)*6;
			const diff = Math.sqrt(diffX*diffX + diffY*diffY);
			if (min === null || diff < min) {
				min = diff;
				winner = child;
				if (/*diffX>110||*/ diffY > 0) {
					winner = winner.nextElementSibling;
				}
			}
		}
	}
	while (winner && (winner===active || winner===ghost)) {
		winner = winner.nextElementSibling;
	}
	return winner;
}

function moveToTargetEffect(element) {
	const clone = element.cloneNode(true);
	document.body.append(clone);
	clone.style.cssText +=
	'width:'+clone.offsetWidth+'px; '+
	'height:'+clone.offsetHeight+'px; '+
	'max-width:none; '+
	'min-width:0; '+
	'max-height:none; '+
	'min-height:0; '+
	'boxSizing:content-box; ';
	const opacity = element.style.opacity;
	setTimeout(()=>{
		const duration = 190;
		const pos = element.getBoundingClientRect();
		element.style.opacity = 0;
		clone.style.cssText +=
		'transition:all '+duration+'ms; '+
		'transition-property:width height top left opacity; '+
		'top:'+pos.top+'px; '+
		'left:'+pos.left+'px; '+
		'width:'+pos.width+'px; '+
		'height:'+pos.height+'px; ';
		setTimeout(()=>{
			clone.style.cssText +=
			'transition-duration:100ms; '+
			'opacity:0; ';
			setTimeout(()=>clone.remove(),100);
			element.style.opacity = opacity;
		},duration);
	});
}
