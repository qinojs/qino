import '../c1/NodeCleaner.mjs';
import './crossbrowser.mjs';

const unwrap = el => el.replaceWith(...el.childNodes); // remove element, keep its children

globalThis.Rte = {
	range : {},
	rangeStaticValues : {},
	checkSelection() {
		/*
		 * Problem:
		 * Should also check for new element when parent elements change
		 * currently the selection and element stay the same even though the DOM structure has changed.
		 *
		 * In webkit ist das Element dann z.T nicht mehr das selbe. dann gehts... (ul maker)
		 *  */
		const sel = getSelection();
		if (!sel.rangeCount) return;
		/* new selection? */
		const newRange = sel.getRangeAt(0).cloneRange(); // cloneRange() needed?
		/* use compareBoundaryPoints? (god example: http://help.dottoro.com/ljxgoxcb.php) */
		const same = newRange.startContainer === Rte.rangeStaticValues.startContainer
				&& newRange.startOffset === Rte.rangeStaticValues.startOffset
				&& newRange.endContainer === Rte.rangeStaticValues.endContainer
				&& newRange.endOffset === Rte.rangeStaticValues.endOffset;
		if (same) return;
		Rte.range = newRange;
		Rte.rangeStaticValues = {
			startContainer: newRange.startContainer,
			startOffset:    newRange.startOffset,
			endContainer:   newRange.endContainer,
			endOffset:      newRange.endOffset,
		};

		/* new element? */
		let tmp = qgSelection.element(); // todo

		if (tmp.tagName !== 'IMG') {
			tmp = Rte.range.commonAncestorContainer.data !== undefined ? Rte.range.commonAncestorContainer.parentNode : Rte.range.commonAncestorContainer;
		}
		let newElement = tmp;
		if (newElement === Rte.active) newElement = false;
		if (Rte.element !== newElement) {
			Rte.element = newElement;
			Rte.trigger('elementchange');
		}
		Rte.trigger('selectionchange');
	},
	manipulate(fn) {
		setTimeout(() => {
			getSelection().c1SetRange(Rte.range);
			fn?.();
			Rte.checkSelection();
	        Rte.trigger('input');
			Rte.active.focus(); // firefox
		}, 80);
	},
	/*
	modifySelection(fn) {
		var els = [Rte.element];
		if (!Rte.range.collapsed) {
			console.log(Rte.range)
			if (rangeIsElement(Rte.range)) {
				els = [Rte.range.commonAncestorContainer];
			} else {
				els = rangeGetElements(Rte.range);
			}
		} else if (els[0] === Rte.active) {
			rangeExpandToElements(Rte.range);
			el = document.createElement('span');
			Rte.range.surroundContents(el);
			Rte.range.selectNodeContents(el);
		}
		fn(els);

		Rte.trigger('input');

		setTimeout(function() {
			var s = getSelection();
			s.c1SetRange(Rte.range);
			Rte.checkSelection();
		},90);
	},
	*/
	addUiElement(el) { // really needed?
		const activate = e => {
			Rte.dontBlur = true;
			const gMousedown = e => {
				if (el.contains(e.target)) return;
				document.removeEventListener('mousedown',gMousedown);
				Rte.dontBlur = false;
				if (!Rte.active) return;
				if (Rte.active.contains(e.target)) return;
				Rte.trigger('deactivate');
	            Rte.active = false;
			};
			document.addEventListener('mousedown',gMousedown);
			e.stopPropagation();
		};
		el.addEventListener('mousedown',activate);
	},
	isTarget(el) {
		return el.isContentEditable && el.tagName!=='INPUT' && el.tagName!=='TEXTAREA' && el.tagName!=='SELECT';
	},
	init() {
		const root = globalThis;
		root.addEventListener('focus',e=>{
	        if (!Rte.isTarget(e.target)) return;
	        if (Rte.active !== e.target) {
		        Rte.active = e.target;
	            Rte.trigger('activate');
		        Rte.checkSelection();
	        }
		},true);
		root.addEventListener('blur',e=>{
	        if (!Rte.isTarget(e.target)) return;
	        if (!Rte.dontBlur && Rte.active) {
	            Rte.trigger('deactivate');
	            Rte.active = false;
	        }
		},true);
		root.addEventListener('keyup',e=>{ // use selectionchange?
	        if (!Rte.isTarget(e.target)) return;
			if (e.key === 'Escape') {
				document.body.focus();
				document.activeElement.blur();
				getSelection().removeAllRanges();
				return;
			}
	        Rte.checkSelection();
	        Rte.trigger('input',e);
		},true);
		root.addEventListener('mouseup',e=>{ // use selectionchange?
			if (!Rte.active) return; // new 15.7.17 // zzz, if used: "root.addEventListener('selectionchange',e=>{"
            if (!Rte.isTarget(e.target)) return;
	        Rte.checkSelection();
		},true);
		root.addEventListener('beforeunload',()=>{ // blur before unload (save), needed?
			if (Rte.active) {
				Rte.active.blur();
				// let event = new Event('blur',{'bubbles': true,'cancelable': true});
				// Rte.active.dispatchEvent(event);
			}
		},true);
	}
};
Object.assign(Rte, c1.Eventer);


qgExecCommand('enableInlineTableEditing', false, false); // bug: if i first click in the table the nativ handles appear
document.addEventListener('DOMContentLoaded', () => qgExecCommand('enableObjectResizing', false, false));


// fake Selection
{
	const el = c1.dom.fragment(`<style>.qgRte_fakeSelection {}</style>`).firstChild;
	document.head.append(el);
	const style = el.sheet.cssRules[0].style;
	style.background = 'rgba(150,150,150,.9)';
	style.color = '#fff';
	Rte.fakeSelection = {
		addClass   (el){ el.classList.add   ('qgRte_fakeSelection'); },
		removeClass(el){ el.classList.remove('qgRte_fakeSelection'); },
	}
}

//ie: prevent resizable handle bug: if i move the image, it will show the handles
/*
document.addEventListener('mouseup', e=>{
	if (e.button!==0) return;
	if (e.target.isContentEditable && e.target.tagName === 'IMG' && !getSelection().isCollapsed && getSelection().toString() === '') {
		qgSelection.toElement(e.target);
		setTimeout(function() {
			qgSelection.toElement(e.target);
			Rte.checkSelection();
		});
	}
});
*/

Rte.init();

/* prevent select on contextmenu */
document.addEventListener('mousedown', e =>
	e.button === 2 && e.target.isContentEditable && e.preventDefault()
);

/* cleaner */
{
	let Cleaner;
	Rte.on('input', () => {
		Cleaner ||= new c1.NodeCleaner();
		Cleaner.cleanContents(Rte.active, true);
	});
}

/* force li's in contenteditable uls */
{
	const check = () => {
		let child;
		for (child of Rte.active.childNodes) {
			if (child.tagName === 'LI') continue;
			if (child.nodeType === 3 && !child.textContent.trim()) continue;
			if (child.nodeName === 'UL') {
				unwrap(child);
				continue;
			}
			const li = document.createElement('li');
			child.before(li);
			li.append(child);
		}
	}
	Rte.on('activate',()=>{
		if (Rte.active.tagName !== 'UL') return;
		check()
		Rte.active.addEventListener('input', check);
	});
	Rte.on('deactivate',()=>{
		if (Rte.active.tagName !== 'UL') return;
		Rte.active.removeEventListener('input', check);
	});
}
/* force p tag inside contenteditable divs */
document.addEventListener('input', e => {
	if (!e.target.isContentEditable) return;
	if (e.target.tagName !== 'DIV') return;
	const sel = getSelection();
	const range = sel.c1GetRange();
	const text = range.startContainer;
	const offset = range.startOffset;
	if (text.nodeType !== 3) return; /* text-node */
	if (text.parentNode === e.target) { // warp blank text-nodes with p
		const p = document.createElement('p');
		text.after(p);
		p.append(text);
		range.setStart(text, offset);
		sel.c1SetRange(range);
	} else { // replace every div with a p
		const div = text.parentNode;
		if (div.tagName !== 'DIV') return;
		//if (div.parentNode !== e.target) return;
		const p = document.createElement('p');
		div.after(p);
		p.append(div)
		unwrap(div);
		range.setStart(text, offset);
		sel.c1SetRange(range);
	}
});
/* force p's to not contain a ul */
document.addEventListener('input', e => {
	if (!e.target.isContentEditable) return;
	if (e.target.tagName !== 'DIV') return;
	const sel = getSelection();
	const range = sel.c1GetRange();
	const text = range.startContainer;
	const offset = range.startOffset;
	if (text.nodeType !== 3) return; // text-node
	const ul = text.parentNode.parentNode;
	if (ul.tagName !== 'UL') return;
	const p = ul.parentNode;
	if (p.tagName !== 'P') return;
	if (p.childNodes.length !== 1) return;
	unwrap(p);
	range.setStart(text, offset);
	sel.c1SetRange(range);
});

/* force br's tag inside contenteditable if not a DIV/TD/TH/UL, (todo, should it be p,h1,h2...?) */
document.addEventListener('keydown', e => {
	if (!e.target.isContentEditable) return;
	if (e.target.tagName === 'DIV') return;
	if (e.target.tagName === 'TD') return;
	if (e.target.tagName === 'TH') return;
	if (e.target.tagName === 'UL') return;
	if (e.code === 'Enter') {
		const br = document.createElement('br');
		const range = getSelection().c1GetRange();
		range.insertNode(br);
		br.append(document.createTextNode(' \n\n'))
		range.setStartAfter(br)
		getSelection().c1SetRange(range);
		e.preventDefault();
	}
});

/* prevent links inside links */
document.addEventListener('input', e => {
	if (!e.target.isContentEditable) return;
	if (!e.target.closest('A')) return;
	let a;
	while ((a = e.target.querySelector('a'))) unwrap(a);
});

/* prevent phx inside phx */
{
	const PHX = {P:1,H1:1,H2:1,H3:1,H4:1,H5:1,H6:1,};
	document.addEventListener('input', e => {
		if (!e.target.isContentEditable) return;
		const check = node => {
			[...node.children].forEach(check); // for of will skip nodes (if some removed)
			if (isPHX(node.parentNode) && isPHX(node)) {
				if (node.nextElementSibling) {
					node.after(document.createElement('br'));
				}
				unwrap(node);
			}
		}
		function isPHX (node){
			return PHX[node.tagName];
		}
		check(e.target)
	});
}
/* */
