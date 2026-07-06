// better known as scrollRestoration: https://www.chromestatus.com/feature/5657284784947200

c1.scrollSync = {
  config : {},
  _elementConfig(el){
    const client = clientDim(el);
    const selector = c1.scrollSync.getSelector(el);
    const config = {
      // pixel: {
      //     x: el.scrollLeft,
      //     y: el.scrollTop,
      // },
      percent: {
        x: el.scrollLeft / (el.scrollWidth  - client.width) || 0,
        y: el.scrollTop  / (el.scrollHeight - client.height) || 0,
      }
    };
    const doc = el.ownerDocument;
    doc.c1ScrollSyncConfig ||= {};
    doc.c1ScrollSyncConfig[selector] = config;
    return { [selector] : config };
  },
  restoreIn(object, win){
    win.c1ScrollSyncPreventFeedback = true;
    for (const selector in object) {
      const el = win.document.querySelector(selector);
      if (!el) continue;
      let top, left;
      // let pixel = object[selector].pixel;
      // if (pixel) { left = pixel.x; top  = pixel.y; }
      const percent = object[selector].percent;
      if (percent) {
        const client = clientDim(el);
        left = (el.scrollWidth  - client.width)  * percent.x;
        top  = (el.scrollHeight - client.height) * percent.y;
      }
      top  = Math.round(top);
      left = Math.round(left);
      el.style.scrollBehavior = 'auto';
      if (el.scrollLeft !== left) el.scrollLeft = left;
      if (el.scrollTop  !== top)  el.scrollTop  = top;
      el.style.scrollBehavior = '';
    }
    win.clearTimeout(win.c1ScrollSyncPreventFeedbackTimeout); // todo: outside loop?
    win.c1ScrollSyncPreventFeedbackTimeout = win.setTimeout(() => win.c1ScrollSyncPreventFeedback = false, 100);
  },
  syncWindows(fromWindow, toWindow){
    const doc = fromWindow.document;
    doc.c1ScrollSyncTargetWindows ||= [];
    doc.c1ScrollSyncTargetWindows.push(toWindow); // massive memory leak? use weekmap?
    fromWindow.addEventListener('scroll',scrollListener,true);
  },
  reevaluate(win){
    for (const el of win.document.querySelectorAll('*')) {
      if (el.scrollTop || el.scrollLeft) {
        this._elementConfig(el);
      }
    }
  },
  getConfig(win){
    const doc = win.document;
    doc.c1ScrollSyncConfig ||= {};
    return doc.c1ScrollSyncConfig;
  }
};
function scrollListener(e) {
  let el = e.target;
  if (el.nodeType === 9) el = el.scrollingElement; // document
  const config = c1.scrollSync._elementConfig(el);
  const doc = el.ownerDocument;
  if (doc.defaultView.c1ScrollSyncPreventFeedback) return;
  if (doc.c1ScrollSyncTargetWindows) {
    doc.c1ScrollSyncTargetWindows.forEach(win => c1.scrollSync.restoreIn(config, win));
  }
  // localStorage // better use sessionStorage?
  //localStorage.setItem('c1.scrollSync', JSON.stringify(c1.scrollSync.config));
}
addEventListener('scroll', scrollListener, true);

// addEventListener('DOMContentLoaded',function(){
//     c1.scrollSync.config = JSON.parse( localStorage.getItem('c1.scrollSync') ) || {};
//     c1.scrollSync.restore(c1.scrollSync.config);
// });
// addEventListener('load',function(){
//     c1.scrollSync.restore(c1.scrollSync.config);
// });

/* helper */
c1.scrollSync.getSelector = function(el){
  const doc = el.ownerDocument;
  let selector = '';
  const root = el.closest('[id]') || doc.documentElement;
  let looped = el;
  while (looped != root) {
    selector = ' > '+looped.tagName.toLowerCase()+':nth-of-type('+countPrevSiblings(looped)+')' + selector;
    looped = looped.parentNode;
  }
  selector = (root === doc.documentElement ? 'html' : '#'+root.id) + selector;
  return selector;
};
function countPrevSiblings(el){
  let i=0, checked = el;
  const tag = el.tagName;
  while (checked) {
    if (checked.tagName === tag) i++;
    checked = checked.previousElementSibling;
  }
  return i;
}
function clientDim() {
  return {
    height:innerHeight,
    width: innerWidth,
  }
}

export default c1.scrollSync;
