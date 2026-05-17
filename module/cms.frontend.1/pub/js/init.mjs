import { apt } from '../../../core/pub/js/apt.js';

const editable = ('qgCmsEditmode' in window); // not available if in backend but no edit-access
function qgCmsToggleEdit(){
	if (!editable) return;
	const url = new URL(location.href);
	url.searchParams.set('qgCms_editmode', qgCmsEditmode?0:1);
	url.searchParams.set('cmspid',qgCmsRequestedPage);
	import(sysURL+'core/pub/js/c1/scrollSync.mjs?qgUniq=b0dfe76').then(function(){
		c1.scrollSync.reevaluate(globalThis);
		const config = c1.scrollSync.getConfig(globalThis);
		localStorage.setItem('cmsLastScrollPosition', JSON.stringify(config));
		location.href = url;
	});
}

document.addEventListener('keydown', function(e) {
	if (e.target.isContentEditable || e.target.form !== undefined) return;
	if (e.shiftKey || e.metaKey || e.altKey || e.ctrlKey) return;
	switch (e.key) {
	case 'e':
		qgCmsToggleEdit();
		break;
	case 'd':
		apt.core['ctx-settings']('core', 'dev').put({value: !qino.dev}).then(() => location.reload());
		break;
	case 'b':
		if (window.cmsBackendUrl) location.href = cmsBackendUrl;
		break;
	}
});

const savedScroll = localStorage.getItem('cmsLastScrollPosition');
if (savedScroll) {
	localStorage.removeItem('cmsLastScrollPosition');
	import(sysURL+'core/pub/js/c1/scrollSync.mjs?qgUniq=b0dfe76').then(function(){
		c1.scrollSync.restoreIn(JSON.parse(savedScroll), globalThis);
	});
}

if (editable) {
	const editToggle = c1.dom.fragment('<a style="position:fixed; z-index:3; cursor:pointer" class="qgCMS_editmode_switch '+(qgCmsEditmode?'-active':'')+' '+(qino?.dev?'-dev':'')+'" title="Bearbeiten (E)"><div><i></i></div></a>').firstChild;
	document.body.append(editToggle);
	editToggle.addEventListener('click',function(){
		qgCmsToggleEdit();
		this.classList.toggle('-active');
	});
}
