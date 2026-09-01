import '@qino/pub/c1/Placer.mjs';
import '@qino/pub/qg/c1Combobox.mjs';
import '@qino/pub/qg/fileHelpers.mjs';
import '@qino/pub/c1/fix/contextMenu.mjs';
import '@qino/pub/c1/contextMenu.mjs';
import { t, api } from '@qino/pub/qino.js';

import { root } from '../js/root.js';

import './rte.js';
import './contextMenu.js';
import './ddConts.js';
import './dropPasteHelper.js';
import './dropPaste.js';

const nodeId = globalThis.qino?.cms?.nodeId;

root.host.addStyle('cms.frontend.4/pub/inline/chrome.css');
cms.dialogs = root;

/** Buttons a host adds to the content menu; `show(contPos)` decides visibility per marked content. */
export const contMenuButtons = [];

/* cms.element? */
cms.contPos = function(el) {
  if (el.cmsContPos) return el.cmsContPos;
  if (!(this instanceof cms.contPos)) return new cms.contPos(el);
  el.cmsContPos = this;

  this.el = el;
  this.pid = el.getAttribute('qcms-id'); // used
  el.addEventListener('mouseleave',this.unmarkDelay.bind(this));
};
Object.assign(cms.contPos, c1.Eventer);

cms.contPos.prototype = {
  isDraggable() {
    if (this.el.classList.contains('-draggable')) return true;
    const p = this.el.parentNode;
    return p.hasAttribute('qcms-edit') && p.hasAttribute('qcms-drop');
  },
  mark(e) {
    const _ = cms.contPos;
    e?.stopPropagation(); // verschachtelt
    _.active?.unmark();
    //_.active && _.active.unmark();
    if (_.moving || _.active === this /*|| this.el.classList.contains('qgCMS-dropTarget')*/) { _.active = null; return; }
    _.active = this;
    this.el.classList.add('qgCmsMarked');
    cms.contPos.trigger('mark', this);
  },
  unmark() {
    clearTimeout(cms.contPos.outTimer);
    if (!cms.contPos.active) return;
    cms.contPos.active.el.classList.remove('qgCmsMarked');
    cms.contPos.active = null;
    cms.contPos.trigger('unmark', this);
  },
  unmarkDelay() {
    clearTimeout(cms.contPos.outTimer);
    cms.contPos.outTimer = setTimeout(this.unmark.bind(this),100);
  },
};
cms.contPos.moving = null;
cms.contPos.active = null;

function contMarkListener(e) {
  if (e.target.nodeType !== 1) return; // firefox on dragenter
  const target = e.target.closest('[qcms-edit]');
  target && cms.contPos(target).mark(e);
}
document.addEventListener('mouseover',contMarkListener);
document.addEventListener('dragenter',contMarkListener);
document.addEventListener('mousedown',contMarkListener);

cms.cont = function(id) {
  if (cms.cont.all[id]) return cms.cont.all[id];
  if (!(this instanceof cms.cont)) return new cms.cont(id);
  cms.cont.all[id] = this;
  this.id = id;
};
Object.assign(cms.cont, c1.Eventer);

cms.cont.prototype = {
  upload(File, complete, replace) {
    const event = { ...c1.Eventer };
    event.pid = this.id;
    event.File = File;
    qgfileUpload(File, 'cmsPageFile', {
      url: location.pathname+'?cmspid='+this.id+'&replace='+(replace||''),
      progress: e => event.trigger('progress', e),
      complete: res => {
        res = JSON.parse(res);
        res.error && cms.dialogs.alert(res.error);
        complete && setTimeout(() => complete(res), 700); // firefox problem?
        event.trigger('complete', res);
      },
    });
    cms.cont.trigger('upload', event);
  },
  async addPosition(){
    const res = await api.cms.node(this.id).html.get();
    loadCallback({ html: res });
  }
};
cms.cont.all = {};
cms.cont.add = mod => api.cms.node(nodeId).contents.post({ module: mod }).then(loadCallback);

function loadCallback(res){
  setTimeout(async ()=>{ // html possibility has content-script that needs header-script to be executed first
    const html = typeof res.html === 'string' ? res.html : res.id ? await api.cms.node(res.id).html.get() : '';
    const el = c1.dom.el(html);
    if (!el) return console.warn('cms.cont.add: no html', res);
    cms.contPos(el);
    cms.contPos.dd.start(el); // todo. what todo?
    el.style.top = '130px';
    el.style.left = '130px';
  });
}

/* element menu */
document.addEventListener('DOMContentLoaded',()=>{

  const p = cms.contPos;
  const menu = c1.dom.el(
    '<div id=qgCmsContPosMenu popover=manual>'+
    '  <div class=-drag title=Verschieben>'+
    '    <svg width="24" height="24" viewBox="0 0 24 24"><path d="M11 18c0 1.1-.9 2-2 2s-2-.9-2-2s.9-2 2-2s2 .9 2 2zm-2-8c-1.1 0-2 .9-2 2s.9 2 2 2s2-.9 2-2s-.9-2-2-2zm0-6c-1.1 0-2 .9-2 2s.9 2 2 2s2-.9 2-2s-.9-2-2-2zm6 4c1.1 0 2-.9 2-2s-.9-2-2-2s-2 .9-2 2s.9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2s2-.9 2-2s-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2s2-.9 2-2s-.9-2-2-2z"></path></svg>'+
    '  </div>'+
    '  <div class=-mod  title=Module></div>'+
    '</div>');
  root.append(menu);
  menu.drag = menu.querySelector('.-drag');
  menu.mod  = menu.querySelector('.-mod');
  menu.addEventListener('mouseenter', e => p.active?.mark(e) )
  menu.addEventListener('mouseleave', e => p.active?.unmarkDelay(e) )
  menu.addEventListener('click',     e => e.stopPropagation() );
  menu.addEventListener('mousedown', e => e.stopPropagation() );

  const trash = c1.dom.el(
    '<div id=qgCmsContTrash popover=manual>'+
    '  <svg width="50" height="60" viewBox="0 -5 26 30">'+
    '    <path class="-lis" d="M18.902 1.194h-1.21C17.368.494 16.66 0 15.843 0H9.727c-.818 0-1.525.493-1.85 1.194h-1.21c-2.242 0-4.076 1.835-4.076 4.078H22.98c0-2.242-1.833-4.078-4.076-4.078z"/>'+
    '    <path d="M3.83 21.988c0 1.97 1.612 3.582 3.583 3.582H18.16c1.97 0 3.58-1.612 3.58-3.582V6.466H3.83v15.522zm12.537-11.94c0-.66.535-1.194 1.194-1.194s1.194.535 1.194 1.194v11.94c0 .66-.534 1.193-1.193 1.193s-1.193-.534-1.193-1.192v-11.94zm-4.775 0c0-.66.534-1.194 1.194-1.194s1.194.535 1.194 1.194v11.94c0 .66-.534 1.193-1.194 1.193s-1.194-.534-1.194-1.192v-11.94zm-4.777 0c0-.66.534-1.194 1.193-1.194.66 0 1.194.535 1.194 1.194v11.94c0 .66-.534 1.193-1.194 1.193-.66 0-1.193-.534-1.193-1.192v-11.94z"/>'+
    '  </svg>'+
    '</div>', 'text/html');
  root.append(trash);

  /* drag drop */
  const dd = new cms.contDrag();
  cms.contPos.dd = dd;

  // The drop targets are on the page, and an open sidebar covers them. So the panel steps aside
  // while something is being placed and comes back the way it was — a new block from the module
  // picker and an existing one being moved are the same gesture, and both need the room. It hangs
  // on the drag and not on "a block was created": creating one places nothing, and a list that
  // adds an entry in place — or a bot doing the same — must not move the user's panel.
  let sidebarBefore = null;

  dd.on('start',e=>{
    const el = e.target;
    dd.targets = document.querySelectorAll('[qcms-drop][qcms-edit], #qgCmsContTrash');
    document.querySelectorAll('[qcms-drop]').forEach(el=>el.classList.add('dropTarget'))
    p.moving = true;
    if (menu.matches(':popover-open')) menu.hidePopover();
    sidebarBefore = cms.panel?.sidebar.value || null;
    if (sidebarBefore) cms.panel.sidebar.set('');
    el.classList.add('-moving');
    trash.classList.add('-dropTarget');
    if (!trash.matches(':popover-open')) trash.showPopover();
  })
  dd.on('change', e => trash.classList.toggle('-full', e.target.id === 'qgCmsContTrash'));
  dd.on('stop',el=>{
    document.querySelectorAll('[qcms-drop]').forEach(el=>el.classList.remove('dropTarget'))
    p.moving = null;
    el.classList.remove('-moving');
    if (!cms.el.nid(el.parentNode)) { // trash
      api.cms.node(cms.el.nid(el)).delete();
    } else {
      const next = el.nextElementSibling ? cms.el.nid(el.nextElementSibling) : null;
      api.cms.node(cms.el.nid(el.parentNode))["insert-before"].put({ id: String(cms.el.nid(el)), before: next ? String(next) : undefined });
    }
    trash.classList.remove('-dropTarget');
    if (trash.matches(':popover-open')) trash.hidePopover();
    // Back to whatever was open: whoever placed three teasers in a row wants the picker again.
    if (sidebarBefore) cms.panel?.sidebar.set(sidebarBefore);
    sidebarBefore = null;
  })

  let startX, startY, ddEl;
  function move(e) {
    if (e.ctrlKey) {
      const pid = cms.el.nid(ddEl);
      api.cms.node(pid).copy.post().then(({ id }) => {
        cms.cont(id).addPosition();
      });
    } else {
      if (Math.max( Math.abs(startX-e.clientX), Math.abs(startY-e.clientY) ) < 6) return;
      dd.start(ddEl, e);
    }
    up();
  }
  function up() {
    document.removeEventListener('mousemove', move);
    document.removeEventListener('mouseup', up);
  }
  menu.addEventListener('mousedown', e=>{
    if (!cms.contPos.active.isDraggable()) return;
    ddEl   = cms.contPos.active.el;
    startX = e.clientX;
    startY = e.clientY;
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
    e.preventDefault();
  })
  //let placer = new c1.Placer(menu, {x:'prepend',y:'before', margin:{top:-.4,left:4,bottom:1,right:0} });/* firefox: top:-.4 */
  const placer = new c1.Placer(menu, {x:'prepend',y:'before', margin:{top:1,left:4,bottom:1,right:0} });
  cms.contPos.on('mark', obj=>{
    if (!menu.matches(':popover-open')) menu.showPopover();
    const isDraggable = obj.isDraggable(),
      mod     = obj.el.getAttribute('qcms-mod') ?? '';
    placer.follow(obj.el);

    menu.mod.innerHTML = mod.replace(/^cont\./,'');
    menu.mod.setAttribute('title',mod+' ('+obj.pid+')');
    menu.drag.style.display = isDraggable ? 'block' : 'none';
    for (const btn of contMenuButtons) {
      if (btn.el.parentNode !== menu) menu.prepend(btn.el); // a fresh c1.dom.el still hangs on its template fragment
      btn.el.style.display = btn.show(obj) ? 'block' : 'none';
    }
    menu.style.cursor = (isDraggable?'move':'default');

    if (obj.el.hasAttribute('qcms-offline')) {
      menu.mod.insertAdjacentHTML('beforeend', '<span style="animation:qgcms_fadeInOut .4s linear alternate infinite; font-family:qg_cms; font-size:1.2em; line-height:.2; display:inline-block; margin-left:.5em"> &#xe901;</span>')
    }
    menu.style.backgroundColor = getComputedStyle(obj.el)['outline-color'];
  });
  cms.contPos.on('unmark', () => menu.matches(':popover-open') && menu.hidePopover() );
  setTimeout(() => document.activeElement.blur());
  globalThis.qino?.cms?.clipboard && import('./clipboard.js').then(({ default: clipboard }) => clipboard(globalThis.qino.cms.clipboard));
});

cms.console = {
  show(msg, type) {
    const el = this.el();
    if (!el.matches(':popover-open')) el.showPopover();
    el.classList.add('-active');
    el.setAttribute('data-type',type);
    el.firstElementChild.textContent = msg;
    clearTimeout(this.timeout);
    this.timeout = setTimeout(()=>el.classList.remove('-active'), 2200);
    setTimeout(()=>el.classList.add('-new')   , 1);
    setTimeout(()=>el.classList.remove('-new'), 100);
  },
  el() {
    let el = root.getElementById('cmsConsole');
    if (!el) {
      root.append(c1.dom.el('<div id=cmsConsole class=qgCMS popover=manual><div class=-msg></div></div>'));
      el = root.getElementById('cmsConsole');
    }
    return el;
  }
};

api.addEventListener('error', ({ detail }) => cms.console.show(detail.error?.message || t`API call failed`, 'error'));

/** A modal with a title line and buttons — c1's dialog shape, on u2's modal. */
export const dialog = (title,body,buttons) =>
  root.modal({
    body: (title ? '<p>'+title+'</p>' : '') + body,
    buttons: buttons?.map(b => ({ ...b, action: b.then })), // c1 used `then`, u2 uses `action`, todo: use action everywhere and remove this mapping
  });

api.on('PUT cms/txt/:id', ({ value }) => {
  if (value?.changed) cms.console.show(t`Der Text wurde gespeichert.`, 'info');
});

api.on('PUT|PATCH|DELETE cms/node/:id/*', ({ params: { id } }) => {
  cms.reloadNode(id);
});

// The pattern above needs a segment after the id, so the node's own routes are listed apart.
// DELETE stays out: the node is gone, there is nothing left to render.
api.on('PATCH cms/node/:id', ({ params: { id } }) => {
  cms.reloadNode(id);
});

import("../js/browserCheck.js");
