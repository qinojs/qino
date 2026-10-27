const unwrap = el => el.replaceWith(...el.childNodes); // remove element, keep its children

const DEFAULT_CONF = {
  tags                   :null,
  tagsRemove             :null,
  styles                 :null,
  attributes             :null,
  removeHiddenElements   :false,
  removeComments         :true,
  removeEmptyInlineSpans :true,
  removeEmptyElements    :false,
  removeUnusedElements   :false,
  removeUnusedStyles     :true,
  removeNbsp             :false,
  replaceCombiningChars  :true,
};

class NodeCleaner {
  constructor (conf) {
    this.conf = { ...DEFAULT_CONF, ...conf };
  }
  cleanContents(el, andChildren) {
    if (!el) return;
    for (const child of [...el.childNodes]) this.clean(child, andChildren); // copy: clean() replaces nodes
  }
  clean(el, andChildren) {
    if (el.nodeType === 1) {
      andChildren && this.cleanContents(el, true); // can clean all content => then cleanTag can clean el too.
      el = this.cleanTag(el);
      if (!el) return;
      this.cleanAttributes(el);
      this.cleanStyle(el);
      this.conf.removeUnusedStyles && removeUnusedStyles(el);
      // this.cleanClass(el);
      removeUnusedAttributes(el);
      this.conf.removeEmptyInlineSpans && removeEmptyInlineSpans(el);
      this.conf.removeUnusedElements && removeUnusedElements(el);
    } else if (el.nodeType === 3) {
      if (this.conf.removeNbsp) el.data = el.data.replace(/\u00a0/g,' ');
      if (this.conf.replaceCombiningChars) normalizeText(el);
      // if (el.previousSibling?.nodeType === 3) { el.previousSibling.data += el.data; el.remove(); } // merge
      // else if (el.data === '') el.remove();
    } else {
      this.conf.removeComments && el.remove();
    }
  }
  cleanTag(el) {
    el = modernize(el);

    const cs = getComputedStyle(el);
    const display = cs.getPropertyValue('display');

    if (this.conf.removeEmptyElements
      && !{IMG:1,BR:1,HR:1}[el.tagName]
      && !el.textContent.trim()
      && !el.querySelector('img')
    ) { el.remove(); return; }

    if (this.conf.removeHiddenElements && display === 'none')    { el.remove(); return; }
    if (this.conf.tagsRemove?.[el.tagName])                      { el.remove(); return; }
    if (!this.conf.tags)       return el;
    if (this.conf.tags[el.tagName]) return el;

    const before = Object.fromEntries(Array.from(cs, p => [p, cs.getPropertyValue(p)]));

    const effectiveDisplay = display || (BLOCK_LIKE_TAGS[el.tagName] ? 'block' : 'inline');
    const nEl = document.createElement(NOT_INLINE[effectiveDisplay] ? 'div' : 'span');

    if (el.hasAttribute('class')) nEl.className = el.className;

    replaceNode(el, nEl);
    // restore styles that changed due to tag replacement
    const after = getComputedStyle(nEl);
    for (const prop of after) {
      if (before[prop] !== after.getPropertyValue(prop))
        nEl.style.setProperty(prop, before[prop]);
    }
    return nEl;
  }
  cleanAttributes(el) {
    if (!this.conf.attributes) return;
    for (const attr of [...el.attributes]) {
      const name = attr.name;
      const value = attr.value;
      const allowed = this.conf.attributes[name];
      if (!allowed) { el.removeAttribute(name); continue; }
      if (allowed === true || allowed === 1) continue;
      // values allowed
      if (allowed[value] || allowed.includes?.(value)) continue;
      el.removeAttribute(name);
    }
  }
  cleanStyle(el) {
    if (!this.conf.styles) return;
    for (const style of [...el.style]) { // copy: removeProperty() shifts the indices
      const allowed = this.conf.styles[style];
      if (!allowed) {
        el.style.removeProperty(style); continue;
      }
      if (allowed === true || allowed === 1) continue;
      // values allowed
      let value = el.style.getPropertyValue(style);
      if (style === 'font-family') value = value.replace(/^["']|["']$/g,'');
      if (allowed[value] || allowed.includes?.(value)) continue;
      el.style.removeProperty(style);
    }
  }
  /*
  cleanClass(el) {
    const allowed = this.conf.classes;
    if (!allowed) return;
    for (const cl of [...el.classList]) allowed.includes(cl) || el.classList.remove(cl);
  }
  */
}

export default NodeCleaner;

function removeUnusedStyles(el) {
  // be sure the node is attached to the document
  const computed = getComputedStyle(el), beforeOriginal = {}, beforeComputed = {};
  let i=0, style;
  while ((style = el.style[i++])) {
    beforeOriginal[style] = el.style.getPropertyValue(style);
    if ({IMG:1,VIDEO:1}[el.tagName] && {width:1,'max-width':1,height:1}[style]) continue; // responsive styles
    beforeComputed[style] = computed.getPropertyValue(style);
  }
  el.style.cssText = '';
  for (style in beforeOriginal) {
    if (beforeComputed[style] !== computed.getPropertyValue(style)) {
      el.style.setProperty(style, beforeOriginal[style]);
    }
  }
}
function removeUnusedAttributes(el) {
  el.getAttribute('style')?.trim() === '' && el.removeAttribute('style');
  el.getAttribute('class')?.trim() === '' && el.removeAttribute('class');
  // non-numeric sizes such as "auto" are invalid attribute values
  if (el.tagName === 'IMG') {
    if (!/^\d/.test(el.getAttribute('height'))) el.removeAttribute('height');
    if (!/^\d/.test(el.getAttribute('width'))) el.removeAttribute('width');
  }
}
function removeEmptyInlineSpans(el) {
  if (el.attributes.length) return;
  if (el.tagName === 'SPAN' && getComputedStyle(el).getPropertyValue('display') === 'inline') unwrap(el);
}
function removeUnusedElements(el) {
  // if (el.tagName === 'A' && el.innerHTML.trim()) { unwrap(el); return; }
  // divs containing only block-likes
  if (!el.attributes.length && el.tagName === 'DIV') {
    let onlyBlocks = true;
    for (const child of el.childNodes) {
      // if (child.nodeType === 8) continue; // comment
      if (child.nodeType === 3) {
        if (child.data.trim() === '') continue;
        onlyBlocks = false;
        break;
      }
      if (!BLOCK_LIKE_TAGS[child.tagName]) { onlyBlocks = false; break; }
    }
    if (onlyBlocks) { unwrap(el); return; }
  }
  // single col tables
  if (el.tagName === 'TABLE') {
    const tr = el.firstElementChild.firstElementChild;
    if (tr.children.length === 1) {
      console.log(el)
      for (const tbody of [...el.children]) {
        for (const tr of [...tbody.children]) {
          for (const td of [...tr.children]) replaceNode(td, document.createElement('div'));
          unwrap(tr);
        }
        unwrap(tbody);
      }
      unwrap(el);
      return;
    }
  }
  // remove Ps inside LIs, todo:better solution?
  if (el.tagName === 'P' && el.parentNode.tagName === 'LI') {
    unwrap(el);
    return;
  }
}
const NOT_INLINE = {block:1,table:1,flex:1,grid:1,'list-item':1,'table-cell':1};
const BLOCK_LIKE_TAGS = {DIV:1,P:1,UL:1,OL:1,TABLE:1,HR:1,H1:1,H2:1,H3:1,H4:1,H5:1,H6:1,NAV:1,MAIN:1,SECTION:1,ARTICLE:1,HEADER:1,FOOTER:1}

// NFC joins combining marks (u + \u0308 → ü); \x1D is unrenderable, found as "ff" in PDF text
function normalizeText(textNode){
  const data = textNode.data.normalize().replace(/\x1D/g, '⚫');
  if (data !== textNode.data) textNode.data = data; // avoid resetting the cursor when unchanged
}

function modernize(n) {
  if (n.hasAttribute('bgcolor')) {
    n.style.backgroundColor = n.getAttribute('bgcolor');
    n.removeAttribute('bgcolor');
  }
  if (n.tagName==='FONT') {
    const span = document.createElement('span');
    const color = n.getAttribute('color');
    const face = n.getAttribute('face');
    const size = n.getAttribute('size');
    color && (span.style.color = color);
    face  && (span.style.fontFamily = face);
    size  && (span.style.fontSize = (parseInt(size)+0.6)/2+'em');
    replaceNode(n, span);
    return span;
  }
  if (n.tagName==='CENTER') {
    const div = document.createElement('div');
    div.style.textAlign = 'center';
    replaceNode(n, div);
    return div;
  }
  return n;
}


/* example
const cleaner = new NodeCleaner({
  tags:       { DIV:1, SPAN:1 },
  tagsRemove: { FONT:1, 'O:P':1, STYLE:1, SCRIPT:1, META:1, LINK:1, TITLE:1 },
  attributes: { href:1, target:['_blank'] }, // true/1, or the allowed values
  styles: {
    'color':       true,
    'font-weight': true,
    'font-family': ['Arial', 'Times'],
    'font-size':   true,
    'font-style':  true,
  },
  //classes: ['myclass', 'yourClass'], // [] removes all
});
cleaner.clean(el, true); // true: children too
*/



/* todo?
for (const cl of [...n.classList]) /^(Mso|Apple-)/.test(cl) && n.classList.remove(cl);
n.removeAttribute('_moz_dirty');
n.removeAttribute('id');
if (n.style.position === 'absolute') n.style.position = '';
*/


function replaceNode(el, newEl){
  el.replaceWith(newEl);
  newEl.appendChild(el);
  unwrap(el);
}
