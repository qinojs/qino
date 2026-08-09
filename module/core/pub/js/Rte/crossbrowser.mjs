// firefox resize images: enableObjectResizing

// scoped query helper
const find = (el, sel) => el.querySelector(':scope '+sel);

globalThis.qgQueryCommandState = function(cmd) {
  try{
    return document.queryCommandState(cmd);
  } catch { /*zzz*/ }
};
globalThis.qgQueryCommandValue = function(cmd) {
  try{
    return document.queryCommandValue(cmd);
  } catch { /*zzz*/ }
};
globalThis.qgExecCommand = function(com,x,val) {
  const _ = qgExecCommand;
  if (!_.cmdUsed) {
    try {
      document.execCommand("styleWithCSS", false, false);
    } catch { /* ignore */ }
    _.cmdUsed = true;
  }
  switch (com) {
    case 'formatblock':
      document.execCommand(com,x,'<'+val+'>');
      document.execCommand(com,x,val);
      break;
    default:
      try {
        document.execCommand(com,x,val);
      } catch { /* ignore */ }
  }
};

// polyfills / extensions

Selection.prototype.c1GetRange = function() {
  return this.rangeCount ? this.getRangeAt(0) : null;
  //return this.getRangeAt(0);
};
Selection.prototype.c1SetRange = function(range) {
  this.removeAllRanges();
  this.addRange(range);
};

globalThis.qgSelection = {
  element() {
    let el;
    if (!getSelection().rangeCount) return;
    const r = getSelection().getRangeAt(0);
    if (!r.collapsed && r.startContainer.childNodes.length) { // images
      el = r.startContainer.childNodes[r.startOffset];
    } else {
      el = r.commonAncestorContainer;
    }
    while (el.nodeType === 3) el = el.parentNode;
    return el;
  },
  text() {
    return getSelection().c1GetRange().toString();
  },
  isElement() {
    const el = this.element();
    const text = el.textContent || el.innerText || '';
    return text === this.text();
  },
  toElement(el) {
    const r = document.createRange();
    r.selectNode(el);
    getSelection().c1SetRange(r);
  },
  toChildren(el) {
    const r = document.createRange();
    r.selectNodeContents(el);
    getSelection().c1SetRange(r);
  },
  surroundContents(el) {
    const range = getSelection().c1GetRange();
    range.surroundContents(el);
    qgSelection.toChildren(el);
    return el;
  },
  collapse(where) {
    try { // firefox has an error
      where === 'start' ? getSelection().collapseToStart() : getSelection().collapseToEnd();
    } catch { /* ignore */ }
  },
  rect() {
    const r = getSelection().c1GetRange();
    let pos = r.getBoundingClientRect();
    if (r.collapsed && pos.top===0 && pos.left ===0) { // bug in chrome, webkit
      const tmpNode = document.createTextNode('\ufeff');
      r.insertNode(tmpNode);
      pos = r.getBoundingClientRect();
      r.setStartAfter(tmpNode);
      tmpNode.remove();
    }
    return pos;
  }
};

// if contenteditable inside a link, test https://jsfiddle.net/k4ozdem1/5/
document.addEventListener('click', e=>{
  if (e.button !== 0) return;
  if (e.target.isContentEditable) e.preventDefault();
  // keyboard click firefox
  try { // on date-inputs explicitOriginalTarget fails because its internal, ignore it
    if (e.explicitOriginalTarget?.isContentEditable) e.preventDefault();
  } catch { /* ignore */ }
});
// prevent (Firefox) placing cursor incorrectly
document.addEventListener('mousedown', e=>{
  if (!e.target.isContentEditable) return;
  const link = e.target.closest('a');
  if (link) {
    const href = link.getAttribute('href')
    link.removeAttribute('href');
    setTimeout(()=>link.setAttribute('href', href))
  }
});

// firefox bug: space in contenteditable not working when in a button
// https://jsfiddle.net/uh7bseLv/46/
// fix does not add nbsp when needed (multiple spaces)

// element inside contenteditable todo:
// https://jsfiddle.net/k2zrp3Lw/3/
// 7.12.23 this seams to be fixed

document.addEventListener('keydown', e=>{
  if (e.key !== ' ') return;
  if (!e.target.isContentEditable) return;
  if (!e.target.closest('button')) return;
  let inputEvent = false;
  function checkInput(){ inputEvent = true }
  e.target.addEventListener('input',checkInput);
  setTimeout(()=>{
    e.target.removeEventListener('input',checkInput);
    if (!inputEvent) {
      const range = getSelection().getRangeAt(0);
      const node = document.createTextNode(" ");
      range.insertNode(node);
      range.setStartAfter(node);
      range.collapse(true);
      getSelection().removeAllRanges();
      getSelection().addRange(range);
    }
  },1) // is 1ms enough?
},true);



// img selectable (webkit,blink) and resize handles
document.addEventListener('mousedown', e=>{
  if (e.button !== 0) return;
  if (!e.target.isContentEditable) return;
  if (e.target.tagName === 'IMG') {
    qgSelection.toElement(e.target);
    qgImageResizeUi(e);
  }
}, true); // capture => if inside stoppropagation

{
  let checkIntr;
  let img = null;
  globalThis.qgImageResizeUi = function(e) {
    img = e.target;
    const hide = e => {
      if (!e || e.target!==img) {
        cont.remove();
        document.removeEventListener('mousedown',hide);
      }
    };
    document.addEventListener('mousedown',hide);
    document.body.append(cont);
    c1.zTop(cont);
    positionize();
    function check() {
      cont.parentNode && img.offsetHeight ? positionize() : (hide(), clearInterval(checkIntr));
    }
    clearInterval(checkIntr);
    checkIntr = setInterval(check, 100);
  };
  const positionize = () => {
    const c      = img.getBoundingClientRect(), // todo: fastdom
      body   = document.documentElement.getBoundingClientRect(),
      bottom = c.bottom - body.top  - 6,
      right  = c.right  - body.left - 6;
    requestAnimationFrame(()=>{
      x.style.left    = right + 'px';                       x.style.top    = (bottom - img.offsetHeight / 2) + 'px';
      y.style.left    = (right - img.offsetWidth / 2)+'px'; y.style.top    = bottom + 'px';
      xy.style.left   = right + 'px';                       xy.style.top   = bottom + 'px';
      info.style.left = right + 16 + 'px';                  info.style.top = bottom + 16 + 'px';
    });
  };
  const startFn = e => {
    const startM   = {x: e.pageX, y: e.pageY};
    const startDim = {x: img.offsetWidth, y: img.offsetHeight};
    const dragger = e.target;
    const moveFn = e => {
      let w = dragger === y ? startDim.x : Math.max(1, startDim.x + e.pageX - startM.x);
      let h = dragger === x ? startDim.y : Math.max(1, startDim.y + e.pageY - startM.y);
      if (!e.ctrlKey && dragger === xy) {
        if (startDim.x / startDim.y < w / h) {
          h = parseInt(startDim.y / startDim.x * w);
        } else {
          w = parseInt(startDim.x / startDim.y * h);
        }
      }
      const dh = parseFloat(h - startDim.y);
      const dw = parseFloat(w - startDim.x);
      requestAnimationFrame(()=>{
        img.style.width  = w + 'px';
        img.style.height = h + 'px';
        info.innerHTML = w+' x '+h+' ('+(dw>0?'+'+dw:dw)+','+(dh>0?'+'+dh:dh)+')';
        info.style.display = 'block';
        c1.zTop(info);
      })
      positionize();
    };
    const stopFn = () => {
      img.dispatchEvent(new Event('qgResize',{bubbles:true}));
      document.removeEventListener('mousemove', moveFn);
      document.removeEventListener('mouseup', stopFn);
    };
    document.addEventListener('mousemove', moveFn);
    document.addEventListener('mouseup', stopFn);
    e.preventDefault();
    e.stopPropagation();
  };
  const ITEM_CSS = ';position:absolute; background-color:#fff; border:1px solid black; height:12px; width:12px; box-sizing:border-box';
  const cont = c1.dom.fragment(
    '<div style="position:absolute; top:0; left:0; width:100%; height:0">'+
    '<div class=-x  style="cursor:e-resize '+ITEM_CSS+'"></div>'+
    '<div class=-y  style="cursor:s-resize '+ITEM_CSS+'"></div>'+
    '<div class=-xy style="cursor:se-resize'+ITEM_CSS+'" title="press ctrl to disable aspect ratio"></div>'+
    '<div class=-info style="position:absolute; background: #fafafa; box-shadow:0 0 .1875rem; font-size:11px; color:#333; padding:.125rem .25rem; border-radius:.125rem"></div>'+
  '</div>').firstChild;
  const x  = find(cont, '>.-x');
  const y  = find(cont, '>.-y');
  const xy = find(cont, '>.-xy');
  const info = find(cont, '>.-info');
  cont.addEventListener('mousedown', startFn);
}


/* contenteditable focus bug */
if (/AppleWebKit\/([\d.]+)/.exec(navigator.userAgent) && document.caretRangeFromPoint) {
  document.addEventListener('DOMContentLoaded', () => {
    const fixEl = document.createElement('input');
    fixEl.style.cssText = 'width:1px;height:1px;border:none;margin:0;padding:0; position:fixed; top:0; left:0';
    fixEl.tabIndex = -1;
    let shouldNotFocus = null;
    function fixSelection(){
      document.body.append(fixEl);
      fixEl.focus();
      fixEl.setSelectionRange(0,0);
      setTimeout(() => fixEl.remove(),100)
    }
    function checkMouseEvent(e){
      if (e.target.isContentEditable) return;
      const range = document.caretRangeFromPoint(e.clientX, e.clientY);
      if (!range) return;
      const wouldFocus = getContentEditableRoot(range.commonAncestorContainer);
      if (!wouldFocus || wouldFocus.contains(e.target)) return;
      shouldNotFocus = wouldFocus;
      setTimeout(() => shouldNotFocus = null);
      if (e.type === 'mousedown') {
        document.addEventListener('mousemove', checkMouseEvent, false);
      }
    }
    document.addEventListener('mousedown', checkMouseEvent, false);
    document.addEventListener('mouseup', () => document.removeEventListener('mousemove', checkMouseEvent, false), false);
    document.addEventListener('focus', e => {
      if (e.target !== shouldNotFocus) return;
      if (!e.target.isContentEditable) return;
      fixSelection();
    }, true);
    document.addEventListener('blur', e => {
      if (e.target !== shouldNotFocus) return;
      if (!e.target.isContentEditable) return;
      setTimeout(() => {
        if (document.activeElement === e.target) return;
        if (!e.target.contains(getSelection().baseNode)) return;
        fixSelection();
      })
    }, true);
  });
}

function getContentEditableRoot(el) {
  if (el.nodeType === 3) el = el.parentNode;
  if (!el.isContentEditable) return false;
  while (el) {
    const next = el.parentNode;
    if (next.isContentEditable) {
      el = next;
      continue
    }
    return el;
  }
}

// firefox always inserts a br-tag at the end, todo: no final solution
document.addEventListener('input',e=>{
  if (!e.target.isContentEditable) return;
  const last = e.target.lastChild;
  if (!last || last.tagName !== 'BR') return;
  last.after(' ');
  last.remove();
  if (e.target.lastChild == e.target.firstChild) e.target.lastChild.remove();
});
