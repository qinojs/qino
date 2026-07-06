
c1.scroll = {
  options: {
    duration:350,
    easing:'easeInOutQuad',
    onfinish:function(){},
  },
  to: function(targetX, targetY, opt) {
    opt = { ...c1.scroll.options, ...opt };
    const docEl = document.documentElement;
    if (!opt.ignorMaxScroll) {
      const maxScrollX = ('scrollMaxX' in globalThis) ? scrollMaxX : (docEl.scrollWidth  - docEl.clientWidth);
      const maxScrollY = ('scrollMaxY' in globalThis) ? scrollMaxY : (docEl.scrollHeight - docEl.clientHeight);
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
    globalThis.__c1_scroll_running = obj;
    document.scrollingElement.style.scrollBehavior = 'auto';
    setTimeout(()=>{
      requestAnimationFrame(step.bind(obj));
    },10)
  },
  toElement: function(el, opt){
    const rect = el.getBoundingClientRect();
    const left = rect.left + scrollX;
    const top  = rect.top + scrollY - (opt.marginTop ?? 0);
    this.to(left, top, opt);
  }
};
function step () {
  if (globalThis.__c1_scroll_running !== this) {
    return;
  }
  const tDiff = Date.now() - this.startTime;

  if (tDiff > 100 && this.lastY !== scrollY || this.lastX !== scrollX) {
    return;
  }
  const t = Math.min(tDiff / this.duration, 1);
  const x = this.targetX - (1 - this.easing(t)) * this.deltaX;
  const y = this.targetY - (1 - this.easing(t)) * this.deltaY;

  scrollTo(x+.5, y+.5);

  if (t >= 1) {
    document.scrollingElement.style.scrollBehavior = '';
    return this.onFinish();
  }

  this.lastX = scrollX;
  this.lastY = scrollY;
  setTimeout(()=>{
    requestAnimationFrame(step.bind(this));
  },12)
}
const Easing = {
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

export default c1.scroll;
