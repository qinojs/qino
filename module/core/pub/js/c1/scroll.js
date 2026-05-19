/* Copyright (c) 2016 Tobias Buschor https://goo.gl/gl0mbf | MIT License https://goo.gl/HgajeK */
!function(){
'use strict';

c1.scroll = {
    options: {
        duration:350,
        easing:'easeInOutQuad',
        onfinish:function(){},
    },
    to: function(targetX, targetY, opt) { // todo different scroll target
        opt = c1.ext(c1.scroll.options, opt);
        const docEl = document.documentElement;
		if (!opt.ignorMaxScroll) { // if scrollarea will grow
			const maxScrollX = ('scrollMaxX' in window) ? scrollMaxX : (docEl.scrollWidth  - docEl.clientWidth);
			const maxScrollY = ('scrollMaxY' in window) ? scrollMaxY : (docEl.scrollHeight - docEl.clientHeight);
			targetX = Math.max(Math.min(maxScrollX, targetX), 0);
			targetY = Math.max(Math.min(maxScrollY, targetY), 0);
		}
    	const obj = {
            targetX,
            targetY,
            deltaX: targetX - scrollX,
            deltaY: targetY - scrollY,
            lastX: scrollX,
            lastY: scrollY,
    		duration: opt.duration,
    		easing: Easing[opt.easing],
    		onFinish: opt.onfinish,
    		startTime: Date.now(),
    	};
        window.__c1_scroll_running = obj;
		document.scrollingElement.style.scrollBehavior = 'auto';
		setTimeout(()=>{
	    	requestAnimationFrame(step.bind(obj));
		},10)
    },
	toElement: function(el, opt){
		const rect = el.getBoundingClientRect();
		const left = rect.left + scrollX;
		const top  = rect.top + scrollY - (opt.marginTop ?? 0); // todo: scrollLeftMargin
		this.to(left, top, opt);
	}
};
function step () {
	// this scrolling is not active! finish but dont trigger finish
    //if (window.__c1_scroll_running !== this) return this.onFinish();
    if (window.__c1_scroll_running !== this) {
//		console.log('other scrolling active?')
		return;
	}
    //if (window.__c1_scroll_running !== this) return this.onFinish();
	// cancel scroll if scroll by hand, exit but dont trigger finish
	// can happen until load :(
	const tDiff = Date.now() - this.startTime;

	if (tDiff > 100 && this.lastY !== scrollY || this.lastX !== scrollX) {  // tDiff > 100 : ios can trigger mousemove before click fires..., not working if css-smooth-scroll
		//console.log('interupted');
		return;
	}
	const t = Math.min(tDiff / this.duration, 1); // time that has passed (0-1)
	//if (t === 1) return this.onFinish(); // Continue as long as the duration is not exceeded // zzz
  	//if (this.targetX === scrollX && this.targetY === scrollY) return this.onFinish(); // todo? Continue as long as the x/y is not exceeded
    const x = this.targetX - (1 - this.easing(t)) * this.deltaX;
	const y = this.targetY - (1 - this.easing(t)) * this.deltaY;


	scrollTo(x+.5, y+.5);

	//if (t === 1) return this.onFinish(); // Continue as long as the duration is not exceeded
	// better?
	if (t >= 1) {
		document.scrollingElement.style.scrollBehavior = ''; // todo, this should also be called on scroll cancel
		return this.onFinish(); // Continue as long as the duration is not exceeded
	}

    this.lastX = scrollX;
    this.lastY = scrollY;
	setTimeout(()=>{
		requestAnimationFrame(step.bind(this));
	},12)
}
const Easing = { // From https://gist.github.com/gre/1650294
	linear:         t => t,
	easeInQuad:     t => t*t,
	easeOutQuad:    t => t*(2-t),
	easeInOutQuad:  t => t<.5 ? 2*t*t : -1+(4-2*t)*t,
	easeInCubic:    t => t*t*t,
	easeOutCubic:   t => (--t)*t*t+1,
	easeInOutCubic: t => t<.5 ? 4*t*t*t : (t-1)*(2*t-2)*(2*t-2)+1,
	easeInQuart:    t => t*t*t*t,
	easeOutQuart:   t => 1-(--t)*t*t*t,
	easeInOutQuart: t => t<.5 ? 8*t*t*t*t : 1-8*(--t)*t*t*t,
	easeInQuint:    t => t*t*t*t*t,
	easeOutQuint:   t => 1+(--t)*t*t*t*t,
	easeInOutQuint: t => t<.5 ? 16*t*t*t*t*t : 1+16*(--t)*t*t*t*t,
};


/*
function getScrollParent(node) {
	if (node == null) return null;
	return node.scrollHeight > node.clientHeight ? node : getScrollParent(node.parentNode);
}
*/

}();
