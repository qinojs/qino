/* Copyright (c) 2016 Tobias Buschor https://goo.gl/gl0mbf | MIT License https://goo.gl/HgajeK */
import { apt } from '../../core/pub/js/apt.js';

c1.c1Use('tableHandles', function() {
	const handles = new c1.tableHandles();
	let active, pid;
	document.documentElement.addEventListener('focus', e => {
		const el = e.target.closest('.-m-cms-cont-table2 > table > tbody > tr > td');
		if (!el) return;
		active = el;
		handles.showTd(active);
		pid = cms.el.pid(active);
	}, true);
	document.addEventListener('blur', () => handles.hide(), true);
	handles.rowRemove.addEventListener('click', () => { document.activeElement.blur(); apt.cms.node(pid).api.post({do:'rowRem', row: active.parentNode.rowIndex}); });
	handles.rowAdd.addEventListener('click',    () => { document.activeElement.blur(); apt.cms.node(pid).api.post({do:'rowAddAfter', row: active.parentNode.rowIndex}); });
	handles.colRemove.addEventListener('click', () => { document.activeElement.blur(); apt.cms.node(pid).api.post({do:'colRem', col: active.cellIndex}); });
	handles.colAdd.addEventListener('click',    () => { document.activeElement.blur(); apt.cms.node(pid).api.post({do:'colAddRight', col: active.cellIndex}); });
});

cms.initCont('cms.cont.table2', function(el) {
	el.addEventListener('paste', e => {
		if (!e.clipboardData.types.includes('text/html')) return;
		let html = e.clipboardData.getData('text/html');
		html = html.replace(/([\s\S]*)<body>/, '').replace(/<\/body>([\s\S]*)/, '');
		html = html.replace('<!--StartFragment-->', '').replace('<!--EndFragment-->', '');
		const table = c1.dom.fragment(html).firstElementChild;
		if (table && table.tagName !== 'TABLE') return;
		e.preventDefault(); // not working!
		setTimeout(function() {
			let targetTd = e.target.closest('.qgCmsCont > table > * > tr > td');
			const startCellIndex = targetTd.cellIndex;
			for (const tbody of table.children) {
				for (const tr of tbody.children) {
					for (const td of tr.children) {
						targetTd.innerHTML = td.innerHTML;
						onPasteFormatNode(targetTd);
						targetTd.dispatchEvent(new Event('blur', {bubbles:true, cancelable:true}));
						targetTd.blur();
						if (!targetTd.nextElementSibling) break;
						targetTd = targetTd.nextElementSibling;
					}
					const targetTr = targetTd.parentNode.nextElementSibling;
					if (!targetTr) break;
					targetTd = targetTr.children[startCellIndex];
				}
			}
		}, 0);
	});
});
