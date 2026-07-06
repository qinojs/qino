c1.loading = {
  mark(el, opt) {
    if (!el) return ()=>{};
    if (el.nodeType) return c1.loading._markElement(el, opt);
    const dones = Array.from(el, el=>c1.loading._markElement(el, opt))
    return ()=>{ for (const done of dones) done(); }
  },
  _markElement(el, {delay = 0, pointerEvents = false} = {}) {
    c1.loading._adoptStyles(el);
    el.loadingTasks ??= 0;
    el.loadingTasks++;
    if (el.loadingTasks === 1) {
      el.c1Loading_oldCssText = el.style.cssText;
      clearTimeout(el.c1ShowLoadingTO);
      el.c1ShowLoadingTO = setTimeout(()=>{
        el.classList.add('c1Loading');
        if (!el.offsetHeight) el.style.minHeight = '36px';
        if (!el.offsetWidth)  el.style.minWidth = '36px';
        el.style.backgroundImage = 'url("data:image/svg+xml;utf8,'+encodeURIComponent(svg.replace('"currentColor"', '"'+getComputedStyle(el).color+'"'))+'")';
      },delay);
      if (!pointerEvents) {
        el.addEventListener('touchstart', this, true);
        el.addEventListener('mousedown', this, true);
        el.addEventListener('click', this, true);
      }
    }
    return () => c1.loading.done(el);
  },
  done(el) {
    el.loadingTasks--;
    clearTimeout(el.c1ShowLoadingTO);
    if (el.loadingTasks === 0) {
      el.classList.remove('c1Loading');
      el.style.cssText = el.c1Loading_oldCssText;
      el.c1Loading_oldCssText = undefined;
      el.removeEventListener('touchstart', this, true);
      el.removeEventListener('mousedown', this, true);
      el.removeEventListener('click', this, true);
    }
  },
  handleEvent(e){
    e.stopPropagation();
    e.cancelable && e.preventDefault();
  },
  _adoptStyles(el) {
    const root = el.getRootNode();
    if (!root.adoptedStyleSheets.includes(sheet)) {
      root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
    }
  }
};

const svg =
'<svg fill="currentColor" width="64px" height="64px" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid">'+
  '<style>'+
  '@keyframes x { '+
  '  from { opacity: 1; transform:scale(1.5); } '+
  '  to   { opacity: .1; transform:scale(1); } '+
  '} '+
  'circle { animation: x 1.4s infinite; will-change:opacity, transform; } '+
  '</style>'+
  '<g transform="translate(50 50)">'+
    '<g transform="rotate(0) translate(34 0)"><circle cx="0" cy="0" r="8"></circle></g>'+
    '<g transform="rotate(45) translate(34 0)"><circle cx="0" cy="0" r="8" style="animation-delay:0.17s"></circle></g>'+
    '<g transform="rotate(90) translate(34 0)"><circle cx="0" cy="0" r="8" style="animation-delay:0.35s"></circle></g>'+
    '<g transform="rotate(135) translate(34 0)"><circle cx="0" cy="0" r="8" style="animation-delay:0.52s"></circle></g>'+
    '<g transform="rotate(180) translate(34 0)"><circle cx="0" cy="0" r="8" style="animation-delay:0.7s"></circle></g>'+
    '<g transform="rotate(225) translate(34 0)"><circle cx="0" cy="0" r="8" style="animation-delay:0.87s"></circle></g>'+
    '<g transform="rotate(270) translate(34 0)"><circle cx="0" cy="0" r="8" style="animation-delay:1.04s"></circle></g>'+
    '<g transform="rotate(315) translate(34 0)"><circle cx="0" cy="0" r="8" style="animation-delay:1.22s"></circle></g>'+
  '</g>'+
'</svg>';

const css =
'.c1Loading { '+
'  background-repeat: no-repeat !important; ' +
'  background-position: 50% !important; ' +
'  background-position-y: min(50%, 10rem) !important; '+
'  background-size: 32px !important; ' +
'  cursor: wait !important; ' +
'} ' +
'.c1Loading > * { ' +
'  opacity:.1; ' +
'  cursor: wait !important; ' +
'} ' +
'button.c1Loading { '+
'  background-position:-100% !important; ' +
'  background-size:2px !important; ' +
'} '+
'button.c1Loading::after { '+
'  content:""; '+
'  display:inline-block; '+
'  width:1.1em; '+
'  height:1.1em; '+
'  margin-left:.3em; ' +
'  background-image:inherit; ' +
'  background-size:contain; ' +
'  background-repeat:no-repeat; ' +
'  vertical-align:middle; ' +
'  margin-top:-.2em; ' +
'} ';
const sheet = new CSSStyleSheet();
sheet.replaceSync(css);

export default c1.loading;
