/* Copyright (c) 2016 Tobias Buschor https://goo.gl/gl0mbf | MIT License https://goo.gl/HgajeK */
/*
let x = my.setItem('Bold',
	{
		shortcut:'l'
	}
);
x.addEventListener('mousedown', function() {
	Rte.modifySelection(function(els) {
		let first = $(els[1]||els[0]);
		let act = first.hasClass('SmallText') ? 'removeClass' : 'addClass';
		for (let i = els.length, el; el = els[--i];) {
			$(el)[act]('SmallText');
		}
	});
});
*/
import './Rte.ui.mjs?qgUniq=077f746';

Rte.ui.setItem('Bold', 					{cmd:'bold',		shortcut:'b', xenable:':not(img)'} );
Rte.ui.setItem('Italic', 				{cmd:'italic',		shortcut:'i', xenable:':not(img)'} );
Rte.ui.setItem('Insertunorderedlist',	{cmd:'insertunorderedlist',shortcut:'8', enable(){ return !c1.rte.blocklessElements[Rte.active.tagName]; } });
Rte.ui.setItem('Insertorderedlist',		{cmd:'insertorderedlist',shortcut:'9', enable(){ return !c1.rte.blocklessElements[Rte.active.tagName]; } });
Rte.ui.setItem('Underline', 			{cmd:'underline',	shortcut:'u', xenable:':not(img)'});
Rte.ui.setItem('Undo', 					{cmd:'undo',	check:false});
Rte.ui.setItem('Redo', 					{cmd:'redo',	check:false});
Rte.ui.setItem('Unlink', 				{cmd:'unlink',	check:false});
Rte.ui.setItem('Hr', 					{cmd:'inserthorizontalrule', check:false, enable(){ return !c1.rte.blocklessElements[Rte.active.tagName]; } });
Rte.ui.setItem('Strikethrough', 		{cmd:'strikethrough', xenable:':not(img)'});

/* Headings */
{
	let opts = Rte.ui.setSelect('Format',{
		click(e) {
			let tag = e.target.getAttribute('value');
			tag && qgExecCommand('formatblock',false,tag);
			let stat = qgQueryCommandValue('formatblock');
			for (let el of opts.children) {
				el.className = el.tagName.toLowerCase()===stat ? '-selected' : '';
			}
		},
		check() {
			let stat = qgQueryCommandValue('formatblock');
			opts.previousElementSibling.innerHTML = Rte.element ? stat : 'Format';
		},
		enable(e) {
			return !c1.rte.blocklessElements[Rte.active.tagName];
		}
	});
	opts.innerHTML =
	'<p  value=p >Paragraph</p>'+
	'<h1 value=h1>Heading 1</h1>'+
	'<h2 value=h2>Heading 2</h2>'+
	'<h3 value=h3>Heading 3</h3>'+
	'<h4 value=h4>Heading 4</h4>'+
	'<h5 value=h5>Heading 5</h5>'+
	'<h6 value=h6>Heading 6</h6>'
}
/* CSS classes */
{
	function useClass(cl) { return cl.match(/^[A-Z]/); };
	let hasClasses; /* check if this-handle is used */
	let check = function(el) {
		let classes = getPossibleClasses(el);
		for (let cl of Object.keys(classes)) {
			hasClasses = hasClasses || useClass(cl);
		}
		sopts.parentElement.style.display = hasClasses ? '' : 'none';
	}.c1Debounce(150);

	let sopts = Rte.ui.setSelect('Style', {
		check() {
			check();
			let classes = Rte.element && Rte.element.className.split(' ').filter(useClass).join(' ') || 'Style';
			sopts.previousElementSibling.innerHTML = classes;
		},
		click() {
			sopts.innerHTML = '';
			let el = qgSelection.isElement() || getSelection().isCollapsed ? Rte.element : null;
			// if (el === Rte.active) return;
			let classes = getPossibleClasses(el);
			for (let sty of Object.keys(classes)) {
				if (!useClass(sty)) return;
				let has = el && el.classList.contains(sty);
				let d = c1.dom.fragment('<div class="'+sty+'">'+sty+'</div>').firstChild;
				sopts.append(d);
				has && d.classList.add('-selected');
				d.onmousedown = function() {
					Rte.manipulate(()=>{
						if (!el) {
							el = qgSelection.surroundContents(document.createElement('span'));
						}
						el.classList.toggle(sty, !has);
					});
				};
				// d.css({
				// 	fontSize:parseInt(d.css('fontSize')).limit(9,18),
				// 	margin:parseInt(d.css('margin')).limit(0,4),
				// 	padding:parseInt(d.css('padding')).limit(0,4),
				// 	letterSpacing:parseInt(d.css('letterSpacing')).limit(0,11),
				// 	borderWidth:parseInt(d.css('borderWidth')).limit(0,4)
				// });
			}
		}
	});
}

/* show invisibles *
{
	function replaceContents(node){
		for (const el of node.childNodes) replaceNode(el);
	}
	function replaceNode(node) {
		if (node.nodeType === 3) { // text-nodes
			let offset = 0;
			for (const char of node.data) {
				if (char === '\xa0') {  // nbsp
					//var x = node.splitText(offset);
				}
				++offset;
			}
		} else {
			replaceContents(node);
		}
	}
	Rte.ui.setItem('ShowInvisibleChars', {
		click(e) {
			let root = Rte.active;
			replaceContents(root);
		}
		,shortcut:'space'
	});
}
/* clean / remove format */
{
	const removeTags = ['FONT','O:P','SDFIELD','SPAN'].reduce((obj, item)=>{ obj[item]=1; return obj; }, {});
	function cleanNode(node) {
	    if (!node) return;
		cleanContents(node);
	    node.nodeType === Node.COMMENT_NODE && node.remove();
		if (node.nodeType === Node.ELEMENT_NODE) {
			if (!Rte.active.contains(node)) return;
			node.removeAttribute('style');
			node.removeAttribute('class');
			node.removeAttribute('align');
			node.removeAttribute('valign');
			node.removeAttribute('border');
			node.removeAttribute('cellpadding');
			node.removeAttribute('cellspacing');
			node.removeAttribute('bgcolor');
			removeTags[node.tagName] && node.removeNode();
			if (node.tagName !== 'IMG') {
				node.removeAttribute('width');
				node.removeAttribute('height');
			}
		}
	}
	function cleanContents(node){
		if (node.childNodes) for (let child of node.childNodes) cleanNode(child);
	}
	Rte.ui.setItem('Removeformat', {
		click(e) {
			let root = e.ctrlKey ? Rte.element : Rte.active;
			cleanContents(root);
		}
		,shortcut:'space'
	});
}
{ /* code */
	let wrapper = c1.dom.fragment(
		'<div id=qgRteHtml>'+
			'<textarea spellcheck=false class=c1Rst></textarea>'+
			'<style>'+
			'	#qgRteHtml { opacity:1; transform:opacity .5s; position:fixed; border:2px solid black; top:40%; left:1%; bottom:1%; right:1%; background:#fff; color:#000; margin:auto; box-shadow:0 0 20px} '+
			'	#qgRteHtml > textarea { position:absolute; inset:0; width:100%; height:100%; font:11px monospace; } '+
			'	#qgRteHtml.-Invisible { opacity:.1; } '+
			'	#qgRteHtml:hover { opacity:1; } '+
			'</style>'+
		'</div>'
	).firstChild;


	let tO = null;
	function makeInvisible(){
		clearTimeout(tO);
		wrapper.classList.remove('-Invisible');
		tO = setTimeout(()=>{
			wrapper.classList.add('-Invisible');
		},700)
	}
	wrapper.addEventListener('keydown', makeInvisible);
	wrapper.addEventListener('mousemove', makeInvisible);

	let html = wrapper.firstChild;
	let el = Rte.ui.setItem('Code', {
		click() {
			let el = Rte.active;
			let sel = window.getSelection();
			let code;
	        if (sel.rangeCount > 0) {
				let range = sel.getRangeAt(0);
	            let startTextNode = document.createTextNode('marker_start_so9df8as0f0');
	            let endTextNode   = document.createTextNode('marker_end_laseg08a0egga');
				let tmpRange = range.cloneRange();
	            tmpRange.collapse(false);
	            tmpRange.insertNode(endTextNode);
				tmpRange = range.cloneRange();
				tmpRange.collapse(true);
	            tmpRange.insertNode(startTextNode);
				code = domCodeIndent(el.innerHTML);

				startTextNode.remove();
				endTextNode.remove();

				let start = code.indexOf('marker_start_so9df8as0f0');
				code = code.replace('marker_start_so9df8as0f0','');
				let end = code.indexOf('marker_end_laseg08a0egga');
				code = code.replace('marker_end_laseg08a0egga','');

				let brsTotal = (code.match(/\n/g)||[]).length;
				let brs 	 = brsTotal && (code.substr(0,start).match(/\n/g)||[]).length;

				setTimeout(()=>{
					html.focus();

					let y = parseInt((html.scrollHeight / brsTotal)*brs - 250);
					brs && (html.scrollTop = y);

					html.setSelectionRange(start, end);
				},10);
			} else {
				code = domCodeIndent(el.innerHTML);
			}
			html.value = code;
			html.onkeyup = html.onblur = function(){
				el.innerHTML = html.value.replace(/\s*\uFEFF\s*/g,'');
				el.dispatchEvent(new Event('input',{'bubbles':true,'cancelable':true}));
			}
			document.body.append(wrapper);
			wrapper.c1ZTop();

			function hide(e) {
				if (e.key==='Escape' || e.target !== html) {
					wrapper.remove();
					document.removeEventListener('keydown',hide);
					document.removeEventListener('mousedown',hide);
					el.focus();
				}
			};
			setTimeout(()=>{
				document.addEventListener('keydown',hide);
				document.addEventListener('mousedown',hide);
			},3);
		},
		shortcut:'h'
	});
	el.classList.add('expert');
}
/* insert table */
Rte.ui.setItem('Table', {
	click() {
		let table = c1.dom.fragment('<table><tr><td>&nbsp;<td>&nbsp;<tr><td>&nbsp;<td>&nbsp;</table>').firstChild;
		let r = getSelection().getRangeAt(0);
		r.deleteContents();
		r.insertNode(table);
		getSelection().collapse(table.c1Find('td'),0);
	},
	enable(){
		return !c1.rte.blocklessElements[Rte.active.tagName];
	}
});
/* delete Element */
Rte.ui.setItem('Del',{
	click(el) { Rte.element.removeNode(); },
	el: c1.dom.fragment('<a style="color:red">Element löschen</a>').firstChild
});
/* Target */
Rte.ui.setItem('LinkTarget', {
	enable:'a, a > *',
	check(el) {
		el = el.closest('a');
		let target = el.getAttribute('target');
		return target && target !== '_self';
	},
	click(){
		let el = Rte.element.closest('a');
		let active = this.el.classList.contains('active');
		el.setAttribute('target', active?'_self':'_blank');
		Rte.trigger('input');
		Rte.active.focus();
		Rte.trigger('elementchange');
	},
	el: c1.dom.fragment('<div class="-item -button">Link in neuem Fenster</div>').firstChild
});
/* Titletag *
{
	let el = c1.dom.fragment('<table style="clear:both"><tr><td style="width:84px">Titel<td><input>').firstChild;
	let inp = el.c1Find('input');
	inp.addEventListener('keyup', function() {
		Rte.element.setAttribute('title',inp.value);
		!inp.value && Rte.element.removeAttribute('title');
		Rte.trigger('input');
	});
	Rte.ui.setItem('AttributeTitle',{
		check(el) {
			inp.value = el ? el.getAttribute('title') : '';
		},
		el: el
	});
}
/* Image Attributes */ {
	let inp = c1.dom.fragment(
		'<table>'+
			'<tr><td style="width:84px">Breite:<td><input class=-x>'+
			'<tr><td>Höhe:<td><input class=-y>'+
			'<tr><td title="Alternativer Text">Alt-Text:<td><input class=-alt>'+
		'</table>').firstChild;
	inp.addEventListener('keyup',e=>{
		let img = Rte.element;
		img.style.width  = inp.c1Find('.-x').value+'px';
		img.style.height = inp.c1Find('.-y').value+'px';
		img.setAttribute('alt', inp.c1Find('.-alt').value);
		if (e.target.classList.contains('-x') || e.target.classList.contains('-y')) {
			Rte.element.dispatchEvent(new Event('qgResize',{bubbles:true}));
		}
		Rte.active.dispatchEvent(new Event('input',{'bubbles':true,'cancelable':true})); // used!
		Rte.trigger('input'); // used?
	})
	Rte.ui.setItem('ImageDimension', {
		check(el) {
			inp.c1Find('.-x').value = el.offsetWidth;
			inp.c1Find('.-y').value = el.offsetHeight;
			inp.c1Find('.-alt').value = el.getAttribute('alt');
		},
		el:inp,
		enable:'img'
	});
}


var imgSizeCache = {};
function ImageRealSize(url, cb) {
	if (!imgSizeCache[url]) {
		var nImg = new Image();
		nImg.src = url;
		nImg.onload = function() {
			cb.apply(null, imgSizeCache[url] = [nImg.width, nImg.height]);
		};
	} else {
		cb.apply(null,imgSizeCache[url]);
	}
}


/* original image */
Rte.ui.setItem('ImgOriginal', {
	enable: 'img',
	click(e) {
		let img = Rte.element;
		let url = img.getAttribute('src').replace(/\/(w|h|zoom|vpos|hpos|dpr)-[^\/]+/g,'');
		ImageRealSize(url, function(w,h) {
			w /= 2; h /= 2; // vorgängig wird dem Server per Cookie mitteilt, dass er die doppelte Auflösung ausliefern soll
			make(w,h);
		});
		function make(w,h) {
			img.setAttribute('src',url);
			img.setAttribute('width',w);
			img.setAttribute('height',h);
			img.style.width = '';
			img.style.maxWidth = '100%';
			img.style.height = 'auto';
			Rte.element.dispatchEvent(new Event('qgResize',{bubbles:true})); // new
			Rte.trigger('input');
			Rte.trigger('elementchange');
		}
	},
	el: c1.dom.fragment('<span class="-item -button" title="Originalgrösse">Originalbild</span>').firstChild
});

/* table handles */
import {TableHandles} from '../c1/tableHandles.mjs?qgUniq=bbcd4cc';
{
	let td, tr, table, index;
	let handles = new TableHandles();
	Rte.on('deactivate',() => handles.hide() );
	function positionize() {
		let e = Rte.element;
		if (!e) return;
		td = e.closest('td');
		if (Rte.active && Rte.active.contains(td)) {
			tr = td.parentNode;
			table = tr.closest('table');
			index = td.cellIndex;
			handles.showTd(td);
		} else {
			handles.hide();
		}
	}
	Rte.on('elementchange activate', positionize);
	handles.root.addEventListener('click',e=>{
		if (e.target.classList.contains('-rowRemove')) {
			tr.remove();
		}
		if (e.target.classList.contains('-rowAdd')) {
			const tr2 = tr.cloneNode(true);
			tr.after(tr2)
		}
		if (e.target.classList.contains('-colRemove')) {
			const trs = table.c1FindAll('> * > tr');
			for (const tr of trs) tr.children[index].remove();
		}
		if (e.target.classList.contains('-colAdd')) {
			const trs = table.c1FindAll('> * > tr');
			for (const tr of trs) {
				const td = c1.dom.fragment('<td><br></td>'); // firefox needs <br> to be able to navigate to the cell
				tr.children[index].after(td);
			}
		}
		const hasTds = table.c1FindAll('> * > tr > *').length;
		!hasTds && table.remove();
		getSelection().modify('move', 'right', 'character'); // chrome bug
		getSelection().modify('move', 'left', 'character');
		Rte.checkSelection();
	});
}

Rte.ui.config = {
	rteDef:{
		main:['LinkInput','Bold','Insertunorderedlist','Link','Removeformat','Format','Style'],
		more:['Italic','Insertorderedlist','Strikethrough','Underline','Hr','Code','Table','Shy',/*'ShowInvisibleChars',*/'LinkTarget','ImgOriginal','ImgOriginalRetina',/*'AttributeTitle',*/'ImageDimension','Tree']
	},
	rteMin:{
		main:['Bold','Insertunorderedlist','Link','Style']
	},
};




{ // show shy, todo: deprecated? css hyphens and text-wrap:balance are widely supported
	Rte.ui.setItem('Shy',{
		click(el) {
			Rte.range.deleteContents();
			Rte.range.insertNode(document.createTextNode('\u00AD'));
console.warn('needed? shoud it be deprecated?');
		},
		el: c1.dom.fragment('<div class="-item -button">Weiches Trennzeichen einfügen</div>').firstChild
	});
	document.head.append(
		c1.dom.fragment(
		'<style>'+
		'.qgRte-mark-char.-Shy::after  { content:"-"; display:inline-block; color:red; opacity:.3; } '+
		//'.qgRte-mark-char.-Nbsp::after { content:"•"; display:inline-block; color:red; opacity:.3; } '+
		'</style>')
	);

	function addMarks(){
		// remove
		var anchor = getSelection().anchorNode;
		if (!anchor) return;
		anchor.parentNode.querySelectorAll('.qgRte-mark-char').forEach(function(marker){
			if (!marker.firstChild) marker.remove();
		});

		//matchText(Rte.active, new RegExp('\u00AD|\u00a0', 'g'), function(node, match, offset) {
		matchText(Rte.active, new RegExp('\u00AD', 'g'), function(node, match, offset) {
			if (node.parentNode.classList.contains('qgRte-mark-char')) return false;
			var span = document.createElement('span');
			span.className = 'qgRte-mark-char';
			if (match === '\u00AD') span.className += ' -Shy';
			//if (match === '\u00a0') span.className += ' -Nbsp';
			span.textContent = match;
			return span;
		});
	}
	function removeMarks(){
		Rte.active.querySelectorAll('.qgRte-mark-char').forEach(el=>el.removeNode())
		Rte.active.normalize();
	}
	Rte.on('activate',addMarks);
	Rte.on('input',addMarks);
	Rte.on('deactivate',removeMarks);


	var matchText = function(node, regex, callback, excludeElements) {
		excludeElements || (excludeElements = ['script', 'style', 'iframe', 'canvas']);
		var child = node.firstChild;
		while (child) {
			if (child.nodeType === 1) {
				if (excludeElements.indexOf(child.tagName.toLowerCase()) > -1) break;
				matchText(child, regex, callback, excludeElements);
			}
			if (child.nodeType === 3) {
				var bk = 0;
				child.data.replace(regex, function(str) {
					var args = [].slice.call(arguments);
					var tag = callback.apply(window, [child].concat(args));
					if (!tag) return false;
					var offset = args[args.length - 2];
					var newTextNode = child.splitText(offset+bk);
					bk -= child.data.length + str.length;
					newTextNode.data = newTextNode.data.substr(str.length);
					child.parentNode.insertBefore(tag, newTextNode);
					child = newTextNode;
				});
				regex.lastIndex = 0;
			}
			child = child.nextSibling;
		}
		return node;
	};

}

/* *
{ // show line-breaks
	document.head.append(
		c1.dom.fragment(
		'<style>'+
		'.qgRte-mark-char.-Br::before { '+
		'	content:"↵";'+
		'	display:inline;'+
		'	display:contents;'+
		'	opacity:.3;'+
		'	margin-left:.2em; '+
		'	font-size:.82em; '+
		'	pointer-events:none; '+ // I don't think it'll do any good
		'}'+
		'</style>')
	);
	function addMarks(){
		if (!Rte.active) return;
		Rte.active.querySelectorAll('br').forEach(br=>{
			if (br.previousElementSibling?.classList.contains('-Br')) return;
			const span = document.createElement('span');
			span.className = 'qgRte-mark-char -Br';
			br.before(span);
		});
	}
	Rte.on('activate',addMarks);
	Rte.on('input',addMarks);
}
/* */