/* Copyright (c) 2016 Tobias Buschor https://goo.gl/gl0mbf | MIT License https://goo.gl/HgajeK */

import '../../../core/pub/js/c1/contextMenu.mjs';
import { apt, ctx } from '../../../core/pub/js/qino.js';
import '../../../cms/pub/js/cms.mjs';
import { t } from '../../../core/pub/js/qino.js';

const sysURL = ctx.sysURL;
const Page = globalThis.qino?.cms?.nodeId;

const Menu = cms.contextMenueContent = c1.globalContextMenu.addMenu(t`CMS Block`,{
	icon: sysURL+'cms.frontend.2/pub/img/module_default.svg',
	selector: '.qgCmsCont.-e, #qgCmsContPosMenu',
});
Menu.addItem(t`Settings`, {
	icon: sysURL+'cms.frontend.2/pub/img/settings.svg',
	selector: '.qgCmsCont.-e, #qgCmsContPosMenu',
	onshow() {
		this.activePid = cms.contPos.active.pid;
		this.disabled = !cms.contPos.active.el.classList.contains('-e');
	},
	onclick() {
		cms.cont.active = this.activePid;
		cms.panel.sidebar.set('settings');
	}
});
Menu.addItem(t`Move`, {
	icon: sysURL+'cms.frontend.2/pub/img/move.svg',
	selector: '.qgCmsCont.-e, #qgCmsContPosMenu',
	onshow() {
		this.activeEl = cms.contPos.active.el;
		this.disabled = !cms.contPos.active.isDraggable();
	},
	onclick() { cms.contPos.dd.start(this.activeEl);  }
});
Menu.addItem(t`Copy`, {
	icon: sysURL+'cms.frontend.2/pub/img/copy.svg',
	selector: '.qgCmsCont.-e, #qgCmsContPosMenu',
	onshow() {
		this.activePid = cms.contPos.active.pid;
		this.disabled = !cms.contPos.active.el.classList.contains('-e');
	},
	onclick() {
		apt.cms.node(this.activePid).copy.post().then(({ id }) => {
			cms.cont(id).addPosition();
		});
	}
});
Menu.addItem(t`Cut`, {
	icon: sysURL+'cms.frontend.2/pub/img/cut.svg',
	selector: '.qgCmsCont.-e, #qgCmsContPosMenu',
	onshow() {
		this.activePid = cms.contPos.active.pid;
		this.disabled = !cms.contPos.active.el.classList.contains('-e');
	},
	onclick() {
		const pid = this.activePid;
		apt.cms.clipboard.put({ value: parseInt(pid) }).then(() => {
			const els = document.querySelectorAll('.-pid'+pid);
			for (const el of els) el.style.opacity = .3;
		});
	}
});
Menu.addItem(t`Delete`, {
	icon: sysURL+'cms.frontend.2/pub/img/delete.svg',
	selector: '.qgCmsCont.-e, #qgCmsContPosMenu',
	onshow() {
		this.activeEl = cms.contPos.active.el;
		this.disabled = !cms.contPos.active.isDraggable();
		t`Really delete this content?`; // preload text
	},
	onclick() {
		const el = this.activeEl;
		if (!confirm(t`Really delete this content?`)) return;
		const pid = cms.el.pid(el);
		el.remove();
		apt.cms.node(pid).delete();
	}
});

const TreeMenu = c1.globalContextMenu;
TreeMenu.addItem(t`Settings`, {
	icon: sysURL+'cms.frontend.2/pub/img/settings.svg',
	selector: '#tree .-title',
	onshow(e) {
		const node = e.currentTarget.closest('u2-tree');
		this.lastPid = node.dataset.key;
		this.disabled = node.data.myaccess < 2;
		cms.Tree.activate(node);
	},
	onclick() {
		cms.cont.active = this.lastPid;
		cms.panel.sidebar.set('settings');
	}
});
TreeMenu.addItem(t`Rename`, {
	icon: sysURL+'cms.frontend.2/pub/img/pencil.svg',
	selector:'#tree .-title',
	onshow(e) {
		const node = e.currentTarget.closest('u2-tree');
		this.lastPid = node.dataset.key;
		this.disabled = node.data.myaccess < 2;
	},
	onclick() {
		const node = cms.Tree.getNodeByKey(this.lastPid);
		cms.Tree.editNode(node);
	}
});
TreeMenu.addItem(t`Copy`, {
	icon: sysURL+'cms.frontend.2/pub/img/copy.svg',
	selector:'#tree .-title',
	onshow(e) {
		const node = e.currentTarget.closest('u2-tree');
		this.lastPid = node.dataset.key;
		this.disabled = node.data.myaccess < 2;
	},
	onclick() {
		const node = cms.Tree.getNodeByKey(this.lastPid);
		cms.frontend2.dialog(t`Copy page "${node.data.title}"?`,'',[
			{
				title:t`Copy page`,then(){
					apt.cms.node(node.data.key).copy.post().then(() => {
						cms.Tree.reloadChildren(cms.Tree.parent(node));
					});
				}
			},{
				title:t`including subpages`,then(){
					apt.cms.node(node.data.key).copy.post({ deep: true }).then(() => {
						cms.Tree.reloadChildren(cms.Tree.parent(node));
					});
				}
			},{
				title:t`Cancel`
			}
		]);
	}
});
TreeMenu.addItem(t`Delete`, {
	icon: sysURL+'cms.frontend.2/pub/img/delete.svg',
	selector: '#tree .-title',
	onshow(e) {
		const node = e.currentTarget.closest('u2-tree');
		this.lastPid = node.dataset.key;
		this.disabled = node.data.myaccess < 2;
		t`Really delete page "${''}"?` // preload translation
	},
	onclick() {
		const n = cms.Tree.getNodeByKey(this.lastPid);
		if (!confirm(t`Really delete page "${n.data.title}"?`)) return;
		apt.cms.node(n.data.key).delete().then(ret => {
			if (ret.parent_id && n.data.key==Page) {
				location.href = "?cmspid="+ret.parent_id;
			} else {
				const s = cms.Tree.neighbor(n);
				n.remove();
				cms.Tree.activate(s);
			}
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
