import { api } from '@qino/pub/api.js';
import { dataTransferToUrl } from '@qino/pub/util/transfer.mjs';

// Read pasted html (or plain text joined with <br>) and pass it to cb. Returns 1 if something was handled, else 0.
function readClipboardHtml(cd, cb) {
  const items = cd.items ?? [];
  let alternative = null;
  for (let i = 0, item; (item = items[i++]);) {
    if (item.type === 'text/html') {
      item.getAsString(cb);
      return 1;
    }
    if (item.type === 'text/plain') alternative = item;
  }
  if (alternative) {
    alternative.getAsString(text => cb(text.replace(/\n/g,'<br>')));
    return 1;
  }
  return 0;
}

// an in-page drag in progress (set on dragstart, cleared on dragend) and the element being dragged
let internalDrag = false;
let draggedEl = null;

const dragOver = e => {
  const el = e.target.closest('[cmstxt][contenteditable]');
  if (!el) return;
  e.stopImmediatePropagation();
  if (internalDrag) return;
  e.preventDefault(); // Needed outside Firefox to access dropped data
  const range = document.caretRangeFromPoint(e.clientX, e.clientY);
  const sel = getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
};

const drop = async e => {
  const txtEl = e.target.closest('[cmstxt][contenteditable]');
  if (!txtEl) return;
  const tid = txtEl.getAttribute('cmstxt');
  e.stopImmediatePropagation();
  setTimeout(() => cms.txtClean(e.target, tid));
  if (internalDrag) {
    // firefox turns any image dropped/moved into a contenteditable into a link, so we place it
    // ourselves. draggedEl is the real dragged element (composedPath sees through the shadow panel).
    const dragImg = draggedEl?.tagName === 'IMG' ? draggedEl : null;
    const range = dragImg && document.caretRangeFromPoint(e.clientX, e.clientY);
    if (range && txtEl.contains(range.startContainer)) {
      e.preventDefault();
      if (txtEl.contains(dragImg)) {
        range.insertNode(dragImg); // move within the field: relocate the existing node
      } else {
        const img = Object.assign(document.createElement('img'), { src: dragImg.getAttribute('src') });
        range.insertNode(img);
        img.addEventListener('load', () => cms.txtCleanElement(img, tid), { once: true });
      }
    }
    return;
  }
  if (e.dataTransfer.files.length) {
    e.preventDefault();
    for (const file of e.dataTransfer.files) {
      if (/[a-z0-9]{8}\.bmp/.test(file.name)) continue; // ignore chrome generated bmp's when draging a html image, prefere the url
      cms.txtAddFile(txtEl, file);
    }
  }
  const fileUrl = dataTransferToUrl(e.dataTransfer);
  if (!fileUrl) return;
  e.preventDefault(); // before await!!
  const pid = await cms.txtIdToPid(tid);
  // todo: intern file
  // Add file to awoid access problems, but its a copy!!!!
  // we only get here if its on other winodw!! (if internalDrag return)
  if (fileUrl.includes(location.host)) {
    const intern = fileUrl.match(/dbFile\/([0-9]+)\//)[1];
    if (intern) {
      api.cms.node(pid).files.post({ file: intern });
      return;
    }
  }
  const res = await api.cms.node(pid).files.post({ file: fileUrl });
  if (!/(jpg|jpeg|gif|png)$/i.test(fileUrl)) return;
  const img = document.createElement('img');
  img.src = res.url+'/'+res.name;
  const r = getSelection().getRangeAt(0);
  r.insertNode(img);
  img.addEventListener('load', () => cms.txtCleanElement(img, tid), {once:true});
}
const paste = e => {
  const txtEl = e.target.closest('[cmstxt][contenteditable]');
  if (!txtEl) return;
  const tid = txtEl.getAttribute('cmstxt');
  const addHtml = html => {
    const s = getSelection();
    const r = s.c1GetRange();
    html = html.replace(/[^]*<!--StartFragment-->/i, '');
    html = html.replace(/<!--EndFragment-->[^]*/i, '');
    html = html.replace(/<\/body>[\s\S]*$/i, '</body>'); // needed?
    const fragment = r.createContextualFragment(html);
    onPasteFormatNode(fragment);
    r.deleteContents();
    r.insertNode(fragment);
    r.collapse(false); // curser at the end, (todo: not allways working...)
    s.c1SetRange(r);
    txtEl.dispatchEvent(new Event('input',{bubbles:true, cancelable: true})); // NEU 9.4.18
  };
  const items = e.clipboardData.items ?? [];
  for (const item of items) {
    item.kind === 'file' && cms.txtAddFile(txtEl, item.getAsFile());
  }
  readClipboardHtml(e.clipboardData, addHtml) && e.preventDefault();
  setTimeout(()=>cms.txtClean(txtEl, tid), 1);
};
const root = document.documentElement;
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
    const tid = el.getAttribute('cmstxt');
    cms.txtClean(e.target, tid);
  }
  internalDrag = false;
});

// contents
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
  if (e.dataTransfer.files.length) {
    let hasOne = false;
    for (const file of e.dataTransfer.files) {
      if (/[a-z0-9]{8}\.bmp/.test(file.name)) continue; // ignore chrome generated bmp's when draging a html image, prefere the url
      hasOne = true;
      cms.cont(pid).upload(file,complete);
    }
    if (hasOne) return;
  }
  const fileUrl = dataTransferToUrl(e.dataTransfer);
  if (!fileUrl) return;
  if (fileUrl.includes(location.host)) {
    const match = fileUrl.match(/dbFile\/([0-9]+)\//);
    if (match) {
      api.cms.node(pid).files.post({ file: match[1] }).then(complete);
      return;
    }
  }
  api.cms.node(pid).files.post({ file: fileUrl }).then(complete);
});
