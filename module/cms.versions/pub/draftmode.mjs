/* Copyright (c) 2016 Tobias Buschor https://goo.gl/gl0mbf | MIT License https://goo.gl/HgajeK */
import { apt, ctx } from '../../core/pub/js/qino.js';

const sysURL = ctx.sysURL;
const Page = ctx.cms?.page;
function panelRoot() {
	return document.querySelector('qino-cms')?.shadowRoot || document;
}
function panelEl(selector) {
	return panelRoot().querySelector(selector);
}
cms.contextMenueContent.addItem('Publish', {
	icon: sysURL+'cms.versions/pub/check.png',
	selector: '.qgCmsCont',
	onshow(e) {
		this.activePid = cms.contPos.active.pid;
		this.disabled = !e.currentTarget.classList.contains('-e');
	},
	onclick() {
		publish(this.activePid);
	}
});
function publish(pid, subPages){
	if (!confirm('Really overwrite the current live version?')) return;
	apt['cms.versions']['publish-cont'].post({ pid, options: {toSpace:0, subPages} }).then(function(){
		location.href = location.href.replace(/#.*$/,'');
	});
}
// frontend integration
var css =
'#qgCmsFrontend1 [itemid=publish].-HasChanges > .-title, #panel [itemid=publish].-HasChanges > .-title { '+
'	background:var(--cms-access-2); '+
'} '+
'#qgCmsFrontend1 [itemid=publish].-HasChanges > .-title::before, #panel [itemid=publish].-HasChanges > .-title::before { '+
'	border-right-color:var(--cms-access-2); '+
'} '+
'#qgCmsFrontend1 [itemid=publish].-HasChanges .qgCms_vers_page_changed, #panel [itemid=publish].-HasChanges .qgCms_vers_page_changed { '+
'	display:block; '+
'} '+
'';
var el = c1.dom.fragment('<div class=-item itemid=publish>'+
	'<div class=-content>'+
		'<div class=-standalone>'+
			'<div class=-h1>Draft</div>'+
			'<div>Overwrite your draft with the current live version</div>'+
			'<div style="text-align:right">'+
				'<button class=-versionUnPublish style="width:200px">Reset draft</button><br><br>'+
				'<label>including subpages <input class=-subPages type=checkbox style="vertical-align:text-bottom"></label><br>'+
			'</div>'+
			'<br><br><br>'+
			'<div class=-h1>Compare</div>'+
			'<div>Compare the differences between draft and live version</div>'+
			'<div style="text-align:right">'+
				'<button style="width:200px" class=-versionCompare>Compare</button>'+
			'</div>'+
			'<br><br><br>'+
			'<div class=-h1>Publish</div>'+
			'<div>Make your draft public!</div>'+
			'<div class=qgCms_vers_page_changed hidden style="color:var(--cms-access-2);">You have unpublished changes!</div>'+
			'<br>'+
			'<div style="text-align:right">'+
				'<button class=-versionPublish style="width:200px">Publish</button><br><br>'+
				'<label>including subpages <input class=-subPages type=checkbox style="vertical-align:text-bottom"></label><br>'+
			'</div>'+
		'</div>'+
	'</div>'+
	'<div class=-title style="xposition:relative">'+
		'<div class=-text>Draft</div>'+
	'</div>'+
	'<style>'+css+'</style>'+
	'</div>').firstChild;
panelEl('#qgCmsFrontend1 > .-sidebar > [itemid="more"], #panel > .-sidebar > [itemid="more"]')?.append(el);

el.querySelector('.-versionCompare').addEventListener('click', async ()=>{
	await import('./comparer.mjs');
	CmsVersComparer.compare(Page,{
		toSpace:0,
		accept(){ publish(Page); },
		acceptText:'Publish'
	});
});
el.querySelector('.-versionPublish').addEventListener('click',function(){
	let subPages = this.parentNode.querySelector('.-subPages').checked;
	publish(Page, subPages);
});
el.querySelector('.-versionUnPublish').addEventListener('click',function(){
	let subPages = this.parentNode.querySelector('.-subPages').checked;
	if (!confirm("Warning!\nReally overwrite the draft?")) return;
	apt['cms.versions']['publish-cont'].post({ pid: Page, options: {toSpace:1, fromSpace:0, subPages} }).then(()=>{
		location.href = location.href.replace(/#.*$/,'');
	});
});

// // change "changed-status"
// Ask.on('complete', function(res) {
// 	if (!res || !res.cms_vers_changed) return;
// 	for (var pid in res.cms_vers_changed) {
// 		pid == Page && el.classList.add('-HasChanges');
// 	}
// });
window.cms_vers_draft_changed && el.classList.add('-HasChanges');
