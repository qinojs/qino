/* Context menu on the page tree (panel shadow root). Block-level items live in inline/contextMenu.js. */
import '@qino/pub/c1/contextMenu.mjs';
import { api } from '@qino/pub/api.js';
import { t } from '@qino/pub/t.js';
import { ctx } from '@qino/pub/qino.js';

import { showSettings } from './contentMenu.js';

const moduleUrl = ctx.moduleUrl;
const nodeId = globalThis.qino?.cms?.nodeId;

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
  onclick() { showSettings(this.lastPid); }
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

