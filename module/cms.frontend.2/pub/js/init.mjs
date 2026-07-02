import '../../../core/pub/js/c1.js';
import { apt, ctx } from '../../../core/pub/js/qino.js';

const editable = globalThis.qino?.cms?.editmode !== undefined; // not available if in backend but no edit-access
function qgCmsToggleEdit(){
	if (!editable) return;
	const url = new URL(location.href);
	url.searchParams.set('qgCms_editmode', globalThis.qino.cms.editmode?0:1);
	url.searchParams.set('cmspid', globalThis.qino.cms.requestedNodeId);
	import('../../../core/pub/js/c1/scrollSync.mjs').then(() => {
		c1.scrollSync.reevaluate(globalThis);
		const config = c1.scrollSync.getConfig(globalThis);
		localStorage.setItem('cmsLastScrollPosition', JSON.stringify(config));
		location.href = url;
	});
}

document.addEventListener('keydown', e => {
	const target = e.composedPath()[0]; // real element even inside shadow DOM (e.target would be the host)
	if (target.getRootNode() !== document) return; // from shadow DOM = a component (tree/panel/…) owns the key
	if (target.isContentEditable || target.form !== undefined) return; // inputs/contenteditable in the light DOM (page content)
	if (e.shiftKey || e.metaKey || e.altKey || e.ctrlKey) return;
	switch (e.key) {
	case 'e':
		qgCmsToggleEdit();
		break;
	case 'd':
		apt.core['ctx-settings']('core', 'dev').put({value: !ctx.dev}).then(() => location.reload());
		break;
	case 'b':
		if (globalThis.qino.cms?.beUrl) location.href = ctx.appURL + globalThis.qino.cms.beUrl.replace(/^\/+/, '');
		break;
	}
});

const savedScroll = localStorage.getItem('cmsLastScrollPosition');
if (savedScroll) {
	localStorage.removeItem('cmsLastScrollPosition');
	import('../../../core/pub/js/c1/scrollSync.mjs').then(() => {
		c1.scrollSync.restoreIn(JSON.parse(savedScroll), globalThis);
	});
}

if (editable) {
	const editToggle = c1.dom.fragment('<a style="position:fixed; z-index:3; cursor:pointer" class="qgCMS_editmode_switch '+(globalThis.qino.cms.editmode?'-active':'')+' '+(ctx.dev?'-dev':'')+'" title="Bearbeiten (E)"><div><i></i></div></a>').firstChild;
	document.body.append(editToggle);
	editToggle.addEventListener('click', e => {
		qgCmsToggleEdit();
		e.currentTarget.classList.toggle('-active');
	});
}
