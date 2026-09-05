import '@qino/pub/c1.js';
import { api } from '@qino/pub/api.js';
import { ctx } from '@qino/pub/qino.js';

/** Select one element, so the editor's tools address it. */
const selectNode = el => {
  const range = document.createRange();
  range.selectNode(el);
  const selection = getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
};

// txt-id to page-id
const txtIds = {};
cms.txtIdToPid = async function(tid) {
  if (txtIds[tid]) return txtIds[tid];
  return txtIds[tid] = await api.cms['node-id-from-txt-id'].get({ id: parseInt(tid) }).then(r => r.id);
};
// clean texts
cms.txtCleanElement = function(el,tid){
  if (el.tagName === 'IMG') {
    el.setAttribute('loading','lazy');
    if (el.src.startsWith('data:')) cms.txtIdToPid(tid).then(pid => cms.imgToDbFile(el, pid));
    if (el.src.includes('dbFile/')) {
      const dim = () => {
        el.style.maxWidth = '100%';
        el.style.width = el.offsetWidth+'px';
        el.style.height = 'auto';
        el.style.setProperty('--shape-outside-url', 'url("'+el.getAttribute('src')+'")');
        el.setAttribute('width', el.offsetWidth);
        el.setAttribute('height', el.offsetHeight);
      };
      if (el.offsetWidth) dim();
      else if (el.complete) requestAnimationFrame(dim);
      else el.addEventListener('load', () => requestAnimationFrame(dim), { once: true });
    }
  }
  if (el.src?.includes('dbFile/')  && el.src .includes(location.host)) { el.src  = ctx.appUrl+el.src .replace(/.*dbFile\//,'dbFile/'); }
  if (el.href?.includes('dbFile/') && el.href.includes(location.host)) { el.href = ctx.appUrl+el.href.replace(/.*dbFile\//,'dbFile/'); }
  el.removeAttribute('cmstxt');
  for (const a of ['qcms-id', 'qcms-mod', 'qcms-edit', 'qcms-drop', 'qcms-offline', 'qcms-name']) el.removeAttribute(a);
};
cms.txtClean = function(el,tid) {
  el = el.data ? el.parentNode : el;
  el.querySelectorAll('*').forEach(el => cms.txtCleanElement(el,tid));
};
// text add file from fs
cms.txtAddFile = async function(txtEl, f) {
  const pid = await cms.txtIdToPid( txtEl.getAttribute('cmstxt') );
  const ph = fileGetPreview(f);
  const complete = r => {
    if (f.c1IsImage()) {
      const load = function() {
        const file = new dbFile(this);
        const max = txtEl.offsetWidth;
        ph.replaceWith(this);
        if (this.width > max) {
          const h = max / this.width * this.height;
          file.set('w',max); file.set('h',h); file.write();
        }
        selectNode(this);
        img.dispatchEvent(new MouseEvent('mousedown',{bubbles:true})); // why
        img.dispatchEvent(new Event('qgResize',{bubbles:true}));
        img.onload = null;
      };
      const img = document.createElement('img');
      img.src = r.url;
      img.onload = load;
    } else {
      ph.style.opacity = '';
      ph.firstElementChild.href = r.url;
      ph.firstElementChild.innerHTML = r.url.replace(/.*\//,'');
    }
    txtEl.focus();
  };
  cms.cont(pid).upload(f,complete);
};

// img to dbfile
cms.imgToDbFile = function(img, pid, cb) {
  const complete = r => {
    const load = () => {
      img.removeEventListener('load',load);
      cb?.(img);
    };
    img.addEventListener('load',load);
    img.src = r.url;
  };
  img.c1ToBlob().then(blob => cms.cont(pid).upload(blob, complete));
};

function fileGetPreview(f) {
  let ph = null;
  if (f.c1IsImage()) {
    ph = c1.dom.el('<img style="max-width:101%; opacity:.6; filter:grayscale(1)">');
    f.c1ToImage(ph);
  } else {
    ph = c1.dom.el('<span><a href="#" target=_blank> '+f.name+' </a></span>');
  }
  const range = getSelection().getRangeAt(0);
  range.insertNode(ph);
  return ph;
}
