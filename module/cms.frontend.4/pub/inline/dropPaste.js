import { dom } from '@qino/pub/c1.js';
import { api } from '@qino/pub/api.js';
import { ctx } from '@qino/pub/qino.js';
import { dataTransferToUrl } from '@qino/pub/util/transfer.mjs';
import { isImage, toBlob, toImage } from '../../../cms/pub/js/fileHelpers.mjs';

// Processing of content dropped or pasted into text fields: upload data urls, size dbFile images,
// strip foreign attributes — plus the drag, drop and paste handlers.

// ─── helpers ────────────────────────────────────────────────────────────────

const root = document.documentElement;

const setRange = range => {
  const sel = getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
};

const selectNode = el => {
  const range = document.createRange();
  range.selectNode(el);
  setRange(range);
};

// Chrome adds a bmp when dragging an html image — prefer the url
const dropFiles = dt => [...dt.files].filter(f => !/[a-z0-9]{8}\.bmp/.test(f.name));

/** dbFile id if the url is ours — our own files must not be copied. */
const dbFileId = url => url.includes(location.host) && url.match(/dbFile\/([0-9]+)\//)?.[1];

// ─── text fields — [cmstxt][contenteditable] ────────────────────────────────

const txtIds = {};
cms.txtIdToPid = async function(tid) {
  if (txtIds[tid]) return txtIds[tid];
  return txtIds[tid] = await api.cms['node-id-from-txt-id'].get({ id: parseInt(tid) }).then(r => r.id);
};
function cleanElement(el, tid) {
  if (el.tagName === 'IMG') {
    el.setAttribute('loading','lazy');
    if (el.src.startsWith('data:')) cms.txtIdToPid(tid).then(pid => imgToDbFile(el, pid));
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
  for (const a of ['cmstxt', 'qcms-id', 'qcms-mod', 'qcms-edit', 'qcms-drop', 'qcms-offline', 'qcms-name']) el.removeAttribute(a);
}
function cleanText(el, tid) {
  el = el.data ? el.parentNode : el;
  el.querySelectorAll('*').forEach(el => cleanElement(el, tid));
}
async function addFile(txtEl, f) {
  const pid = await cms.txtIdToPid( txtEl.getAttribute('cmstxt') );
  const ph = fileGetPreview(f);
  const complete = r => {
    if (isImage(f)) {
      const img = document.createElement('img');
      img.onload = () => {
        const max = txtEl.offsetWidth;
        ph.replaceWith(img);
        if (img.width > max) {
          new dbFile(img).set('w', max).set('h', max / img.width * img.height).write();
        }
        selectNode(img);
        img.dispatchEvent(new MouseEvent('mousedown',{bubbles:true})); // why
        img.dispatchEvent(new Event('qgResize',{bubbles:true}));
        img.onload = null;
      };
      img.src = r.url;
    } else {
      ph.style.opacity = '';
      ph.firstElementChild.href = r.url;
      ph.firstElementChild.textContent = r.url.replace(/.*\//,'');
    }
    txtEl.focus();
  };
  cms.cont(pid).upload(f,complete);
}

function imgToDbFile(img, pid) {
  toBlob(img).then(blob => cms.cont(pid).upload(blob, r => img.src = r.url));
}

function fileGetPreview(f) {
  let ph;
  if (isImage(f)) {
    ph = dom.el('<img style="max-width:101%; opacity:.6; filter:grayscale(1)">');
    toImage(f, ph);
  } else {
    ph = dom.el('<span><a href="#" target=_blank></a></span>');
    ph.firstElementChild.textContent = ' '+f.name+' '; // as text, not html
  }
  const range = getSelection().getRangeAt(0);
  range.insertNode(ph);
  return ph;
}

// set on dragstart, cleared on dragend
let internalDrag = false;
let draggedEl = null;

const dragOver = e => {
  const el = e.target.closest('[cmstxt][contenteditable]');
  if (!el) return;
  e.stopImmediatePropagation();
  if (internalDrag) return;
  e.preventDefault(); // Needed outside Firefox to access dropped data
  setRange(document.caretRangeFromPoint(e.clientX, e.clientY));
};

const drop = async e => {
  const txtEl = e.target.closest('[cmstxt][contenteditable]');
  if (!txtEl) return;
  const tid = txtEl.getAttribute('cmstxt');
  e.stopImmediatePropagation();
  setTimeout(() => cleanText(e.target, tid));
  if (internalDrag) {
    // firefox turns images dropped into a contenteditable into links, so we place it ourselves.
    // draggedEl is the real dragged element (composedPath sees through the shadow panel).
    const dragImg = draggedEl?.tagName === 'IMG' ? draggedEl : null;
    const range = dragImg && document.caretRangeFromPoint(e.clientX, e.clientY);
    if (range && txtEl.contains(range.startContainer)) {
      e.preventDefault();
      if (txtEl.contains(dragImg)) {
        range.insertNode(dragImg); // move within the field: relocate the existing node
      } else {
        const img = Object.assign(document.createElement('img'), { src: dragImg.getAttribute('src') });
        range.insertNode(img);
        img.addEventListener('load', () => cleanElement(img, tid), { once: true });
      }
      txtEl.dispatchEvent(new Event('input', { bubbles: true })); // we placed it ourselves -> no native input event
    }
    return;
  }
  if (e.dataTransfer.files.length) {
    e.preventDefault();
    for (const file of dropFiles(e.dataTransfer)) addFile(txtEl, file);
  }
  const fileUrl = dataTransferToUrl(e.dataTransfer);
  if (!fileUrl) return;
  e.preventDefault(); // before await!!
  const pid = await cms.txtIdToPid(tid);
  // todo: intern file
  // Add file to awoid access problems, but its a copy!!!!
  // we only get here if its on other winodw!! (if internalDrag return)
  const intern = dbFileId(fileUrl);
  if (intern) {
    api.cms.node(pid).files.post({ file: intern });
    return;
  }
  const res = await api.cms.node(pid).files.post({ file: fileUrl });
  if (!/(jpg|jpeg|gif|png)$/i.test(fileUrl)) return;
  const img = document.createElement('img');
  img.src = res.url+'/'+res.name;
  const r = getSelection().getRangeAt(0);
  r.insertNode(img);
  img.addEventListener('load', () => cleanElement(img, tid), {once:true});
}
// Inserting and cleaning pasted html is the editor's job (--u2-rte, see page.css). Here: upload
// clipboard files, then process the result (upload data urls, size dbFile images, strip attributes).
const paste = e => {
  const txtEl = e.target.closest('[cmstxt][contenteditable]');
  if (!txtEl) return;
  const tid = txtEl.getAttribute('cmstxt');
  // A file without html: the browser would insert a data url and save before the upload is done,
  // so we insert it ourselves. With html the editor inserts, and checkMedia offers to copy foreign files.
  if (!e.clipboardData.types.includes('text/html')) {
    for (const item of e.clipboardData.items ?? []) {
      if (item.kind !== 'file') continue;
      e.preventDefault();
      addFile(txtEl, item.getAsFile());
    }
  }
  // PDF viewers label plain text as text/html without tags; html would drop the line breaks. It is
  // already escaped, so only add the breaks.
  const html = e.clipboardData.getData('text/html').replace(/\s+$/, '');
  if (html.includes('\n') && !html.includes('<')) {
    e.preventDefault();
    const range = getSelection().getRangeAt(0);
    range.deleteContents();
    range.insertNode(range.createContextualFragment(html.replace(/\r?\n/g, '<br>\n')));
    range.collapse(false);
    txtEl.dispatchEvent(new Event('input', { bubbles: true })); // we inserted, so no native input event
  }
  setTimeout(()=>cleanText(txtEl, tid), 1);
};
root.addEventListener('dragover', dragOver);
root.addEventListener('drop',     drop);
root.addEventListener('paste',    paste);

root.addEventListener('dragstart',  e => { internalDrag = true; draggedEl = e.composedPath()[0]; });
root.addEventListener('dragend',    () => internalDrag = false );

root.addEventListener('input', e => {
  if (internalDrag) {
    // input while drop from drag inside;
    // Chrome needs a canceled dragover to fire drop
    const el = e.target.closest('[cmstxt]');
    if (!el) return;
    cleanText(e.target, el.getAttribute('cmstxt'));
  }
  internalDrag = false;
});

// ─── nodes (content blocks) — [qcms-id] ─────────────────────────────────────

root.addEventListener('dragover', e=>{
  const el = e.target.closest('[qcms-id]');
  if (!el) return;
  e.stopPropagation();
  e.preventDefault();
});
root.addEventListener('drop', e=>{
  const pid = cms.el.nid(e.target);
  if (!pid) return;
  e.stopPropagation();
  e.preventDefault();
  function complete() { api.cms.node(pid).html.get().then(html => { document.querySelector('[qcms-id="'+pid+'"]').outerHTML = html; }); }
  const files = dropFiles(e.dataTransfer);
  for (const file of files) cms.cont(pid).upload(file, complete);
  if (files.length) return;
  const fileUrl = dataTransferToUrl(e.dataTransfer);
  if (!fileUrl) return;
  api.cms.node(pid).files.post({ file: dbFileId(fileUrl) || fileUrl }).then(complete);
});
