import '@qino/pub/c1/contextMenu.mjs';
import { api, ctx, t } from '@qino/pub/qino.js';

import '../../../cms/pub/js/cms.mjs';

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
  onclick() {
    cms.cont.active = this.activePid;
    cms.panel.sidebar.set('settings');
  }
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

const treeMenu = c1.globalContextMenu;
treeMenu.addItem(t`Settings`, {
  icon: moduleUrl+'cms.frontend.2/pub/img/settings.svg',
  selector: '#tree .-title',
  onshow(e) {
    const node = e.currentTarget.closest('u2-tree');
    this.lastPid = node.dataset.id;
    this.disabled = node.data.myaccess < 2;
    cms.Tree.activate(node);
  },
  onclick() {
    cms.cont.active = this.lastPid;
    cms.panel.sidebar.set('settings');
  }
});
treeMenu.addItem(t`Rename`, {
  icon: moduleUrl+'cms.frontend.2/pub/img/pencil.svg',
  selector:'#tree .-title',
  onshow(e) {
    const node = e.currentTarget.closest('u2-tree');
    this.lastPid = node.dataset.id;
    this.disabled = node.data.myaccess < 2;
  },
  onclick() {
    const node = cms.Tree.getNodeById(this.lastPid);
    cms.Tree.editNode(node);
  }
});
treeMenu.addItem(t`Copy`, {
  icon: moduleUrl+'cms.frontend.2/pub/img/copy.svg',
  selector:'#tree .-title',
  onshow(e) {
    const node = e.currentTarget.closest('u2-tree');
    this.lastPid = node.dataset.id;
    this.disabled = node.data.myaccess < 2;
  },
  onclick() {
    const node = cms.Tree.getNodeById(this.lastPid);
    cms.frontend2.dialog(t`Copy page "${node.data.title}"?`,'',[
      {
        title:t`Copy page`,then(){
          api.cms.node(node.data.id).copy.post().then(() => {
            cms.Tree.reloadChildren(cms.Tree.parent(node));
          });
        }
      },{
        title:t`including subpages`,then(){
          api.cms.node(node.data.id).copy.post({ deep: true }).then(() => {
            cms.Tree.reloadChildren(cms.Tree.parent(node));
          });
        }
      },{
        title:t`Cancel`
      }
    ]);
  }
});
treeMenu.addItem(t`Delete`, {
  icon: moduleUrl+'cms.frontend.2/pub/img/delete.svg',
  selector: '#tree .-title',
  onshow(e) {
    const node = e.currentTarget.closest('u2-tree');
    this.lastPid = node.dataset.id;
    this.disabled = node.data.myaccess < 2;
    t`Really delete page "${''}"?` // preload translation
  },
  async onclick() {
    const n = cms.Tree.getNodeById(this.lastPid);
    if (!await cms.dialogs.confirm(t`Really delete page "${n.data.title}"?`)) return;
    api.cms.node(n.data.id).delete().then(ret => {
      if (ret.parent_id && n.data.id==nodeId) {
        location.href = "?cmspid="+ret.parent_id;
        return;
      }
      const s = cms.Tree.neighbor(n);
      n.remove();
      cms.Tree.activate(s);
    });
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
