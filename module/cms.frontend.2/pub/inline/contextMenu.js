import '@qino/pub/c1/contextMenu.mjs';
import { api, ctx, t } from '@qino/pub/qino.js';

import '../../../cms/pub/js/cms.mjs';
import { showSettings } from './host.js';

const moduleUrl = ctx.moduleUrl;
const nodeId = globalThis.qino?.cms?.nodeId;
const BLOCK_SELECTOR = '[qcms-edit], #qgCmsContPosMenu';

const menu = cms.contextMenueContent = c1.globalContextMenu.addMenu(t`CMS Block`,{
  icon: moduleUrl+'cms.frontend.2/pub/img/module_default.svg',
  selector: BLOCK_SELECTOR,
});
menu.addItem(t`Settings`, {
  icon: moduleUrl+'cms.frontend.2/pub/img/settings.svg',
  selector: BLOCK_SELECTOR,
  onshow() {
    this.activePid = cms.contPos.active.pid;
    this.disabled = !cms.contPos.active.el.hasAttribute('qcms-edit');
  },
  onclick() { showSettings(this.activePid); }
});
menu.addItem(t`Move`, {
  icon: moduleUrl+'cms.frontend.2/pub/img/move.svg',
  selector: BLOCK_SELECTOR,
  onshow() {
    this.activeEl = cms.contPos.active.el;
    this.disabled = !cms.contPos.active.isDraggable();
  },
  onclick() { cms.contPos.dd.start(this.activeEl);  }
});
menu.addItem(t`Copy`, {
  icon: moduleUrl+'cms.frontend.2/pub/img/copy.svg',
  selector: BLOCK_SELECTOR,
  onshow() {
    this.activePid = cms.contPos.active.pid;
    this.disabled = !cms.contPos.active.el.hasAttribute('qcms-edit');
  },
  onclick() {
    api.cms.node(this.activePid).copy.post().then(({ id }) => {
      cms.cont(id).addPosition();
    });
  }
});
menu.addItem(t`Cut`, {
  icon: moduleUrl+'cms.frontend.2/pub/img/cut.svg',
  selector: BLOCK_SELECTOR,
  onshow() {
    this.activePid = cms.contPos.active.pid;
    this.disabled = !cms.contPos.active.el.hasAttribute('qcms-edit');
  },
  onclick() {
    const pid = this.activePid;
    api.cms.clipboard.put({ value: parseInt(pid) }).then(() => {
      const els = document.querySelectorAll('[qcms-id="'+pid+'"]');
      for (const el of els) el.style.opacity = .3;
    });
  }
});
menu.addItem(t`Delete`, {
  icon: moduleUrl+'cms.frontend.2/pub/img/delete.svg',
  selector: BLOCK_SELECTOR,
  onshow() {
    this.activeEl = cms.contPos.active.el;
    this.disabled = !cms.contPos.active.isDraggable();
    t`Really delete this content?`; // preload text
  },
  async onclick() {
    const el = this.activeEl;
    if (!await cms.dialogs.confirm(t`Really delete this content?`)) return;
    const pid = cms.el.nid(el);
    el.remove();
    api.cms.node(pid).delete();
  }
});

// on contextmenu stop marking other contents. Also for native contextmenu (firefox)
// move to core?
const ignoreMouse = e=>{
  e.stopPropagation();
  e.preventDefault();
};
const ignoreMouseEnd = ()=>{
  document.removeEventListener('mouseover',ignoreMouse,true);
  document.removeEventListener('mouseleave',ignoreMouse,true);
  document.removeEventListener('mousedown',ignoreMouseEnd,true);
};
document.addEventListener('contextmenu',()=>{
  ignoreMouseEnd();
  if (!cms.contPos.active) return;
  document.addEventListener('mouseover',ignoreMouse,true);
  document.addEventListener('mouseleave',ignoreMouse,true);
  document.addEventListener('mousedown',ignoreMouseEnd,true);
  cms.contPos.active.mark();
});
