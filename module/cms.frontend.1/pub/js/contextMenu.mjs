/* Copyright (c) 2016 Tobias Buschor https://goo.gl/gl0mbf | MIT License https://goo.gl/HgajeK */

import '../../../core/js/c1/contextMenu.mjs?qgUniq=11ccbd1';
import { apt } from '../../../core/js/apt.js';
import '../../../cms/pub/js/cms.mjs';

let Menu = cms.contextMenueContent = c1.globalContextMenu.addMenu('CMS Inhalt',{
	icon: sysURL+'cms.frontend.1/pub/img/module_default.svg',
	selector: '.qgCmsCont.-e, #qgCmsContPosMenu',
});
Menu.addItem('Einstellungen', {
	icon: sysURL+'cms.frontend.1/pub/img/settings.svg',
	selector: '.qgCmsCont.-e, #qgCmsContPosMenu',
	onshow(e) {
		this.activePid = cms.contPos.active.pid;
		this.disabled = !cms.contPos.active.el.classList.contains('-e');
	},
	onclick() {
		cms.cont.active = this.activePid;
		cms.panel.set('sidebar','settings');
	}
});
Menu.addItem('Verschieben', {
	icon: sysURL+'cms.frontend.1/pub/img/move.svg',
	selector: '.qgCmsCont.-e, #qgCmsContPosMenu',
	onshow(e) {
		this.activeEl = cms.contPos.active.el;
		this.disabled = !cms.contPos.active.isDraggable();
	},
	onclick() { cms.contPos.dd.start(this.activeEl);  }
});
Menu.addItem('Kopieren', {
	icon: sysURL+'cms.frontend.1/pub/img/copy.svg',
	selector: '.qgCmsCont.-e, #qgCmsContPosMenu',
	onshow(e) {
		this.activePid = cms.contPos.active.pid;
		this.disabled = !cms.contPos.active.el.classList.contains('-e');
	},
	onclick() {
		apt.cms.node(this.activePid).copy.post().then(({ id }) => {
			cms.cont(id).addPosition();
		});
	}
});
Menu.addItem('Ausschneiden', {
	icon: sysURL+'cms.frontend.1/pub/img/cut.svg',
	selector: '.qgCmsCont.-e, #qgCmsContPosMenu',
	onshow(e) {
		this.activePid = cms.contPos.active.pid;
		this.disabled = !cms.contPos.active.el.classList.contains('-e');
	},
	onclick() {
		const pid = this.activePid;
		apt.cms.clipboard.put({ value: parseInt(pid) }).then(() => {
			let els = document.querySelectorAll('.-pid'+pid);
			for (let el of els) el.style.opacity = .3;
		});
	}
});
Menu.addItem('Löschen', {
	icon: sysURL+'cms.frontend.1/pub/img/delete.svg',
	selector: '.qgCmsCont.-e, #qgCmsContPosMenu',
	onshow(e) {
		this.activeEl = cms.contPos.active.el;
		this.disabled = !cms.contPos.active.isDraggable();
	},
	onclick() {
		const el = this.activeEl;
		if (!confirm('Möchten Sie den Inhalt wirklich löschen?')) return;
		const pid = cms.el.pid(el);
		el.remove();
		apt.cms.node(pid).delete();
	}
});

let TreeMenu = c1.globalContextMenu;
TreeMenu.addItem('Einstellungen', {
	icon: sysURL+'cms.frontend.1/pub/img/settings.svg',
	selector: '#qgCmsFrontend1 .dynatree-node',
	onshow(e) {
		this.contextTarget = e.currentTarget;
		this.lastPid = this.contextTarget.parentNode.title.replace('ID ','');
		const access = e.currentTarget.className.match(/-access-([0-9])/)[1];
		this.disabled = access < 2;
		const n = cms.Tree.getNodeByKey(this.lastPid);
		n.activate();
	},
	onclick() {
		cms.cont.active = this.lastPid;
		cms.panel.set('sidebar','settings');
	}
});
TreeMenu.addItem('Umbenennen', {
	icon: sysURL+'cms.frontend.1/pub/img/pencil.svg',
	selector:'#qgCmsFrontend1 .dynatree-node',
	onshow(e) {
		const el = e.currentTarget;
		this.lastPid = el.parentNode.title.replace('ID ','');
		const access = el.className.match(/-access-([0-9])/)[1];
		this.disabled = access < 2;
	},
	onclick() {
		const node = cms.Tree.getNodeByKey(this.lastPid);
		cms.Tree.editNode(node);
	}
});
TreeMenu.addItem('Kopieren', {
	icon: sysURL+'cms.frontend.1/pub/img/copy.svg',
	selector:'#qgCmsFrontend1 .dynatree-node',
	onshow(e) {
		const el = e.currentTarget;
		const access = el.className.match(/-access-([0-9])/)[1];
		this.lastPid = el.parentNode.title.replace('ID ','');
		this.disabled = access < 2;
	},
	onclick() {
		const node = cms.Tree.getNodeByKey(this.lastPid);
		cms.frontend1.dialog('Die Seite "'+node.data.title+'" kopieren?','',[
			{
				title:'Seite kopieren',then(){
					apt.cms.node(node.data.key).copy.post().then(() => {
						node.parent.reloadChildren();
					});
				}
			},{
				title:'inklusiv Unterseiten',then(){
					apt.cms.node(node.data.key).copy.post({ deep: true }).then(() => {
						node.parent.reloadChildren();
					});
				}
			},{
				title:'Abbrechen'
			}
		]);
	}
});
TreeMenu.addItem('Löschen', {
	icon: sysURL+'cms.frontend.1/pub/img/delete.svg',
	selector: '#qgCmsFrontend1 .dynatree-node',
	onshow(e) {
		const el = e.currentTarget;
		const access = el.className.match(/-access-([0-9])/)[1];
		this.lastPid = el.parentNode.title.replace('ID ','');
		this.disabled = access < 2;
	},
	onclick() {
		const n = cms.Tree.getNodeByKey(this.lastPid);
		if (!confirm('Möchten Sie die Seite "'+n.data.title+'" wirklich löschen?')) return;
		apt.cms.node(n.data.key).delete().then(ret => {
			if (ret.parent_id && n.data.key==Page) {
				location.href = "?cmspid="+ret.parent_id;
			} else {
				const s = n.getPrevSibling() || n.getNextSibling() || n.parent;
				n.remove();
				s && s.activate();
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
