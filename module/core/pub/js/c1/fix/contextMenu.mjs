// polyfill
import '../focusIn.mjs';

document.addEventListener('DOMContentLoaded',()=>{
	if (document.body.contextMenu !== undefined) return;

	document.documentElement.addEventListener('contextmenu', e=>{
		if (e.shiftKey) return;
		const base = e.target.closest('[contextmenu]');
		if (!base) return;
		const mEl = document.getElementById(base.getAttribute('contextmenu'));
		if (!mEl?.children.length) return;
		e.preventDefault();
		parse(mEl, poly);
		poly.style.display = 'block';
		poly.showPopover();
		const top  = Math.min(innerHeight - poly.offsetHeight, e.clientY);
		const left = Math.min(innerWidth  - poly.offsetWidth, e.clientX);
		poly.style.top  = top+'px';
		poly.style.left = left+'px';
		poly.focus();
	});
	const poly = c1.dom.fragment('<ul id=contextMenuePolyfill popover=manual tabindex=0>').firstChild;
	document.body.append(poly);
	poly.addEventListener('focusout',e=>{
		if (poly.contains(e.relatedTarget)) return;
		poly.hidePopover();
		poly.style.display = 'none';
	});
	function parse(mEl, poly) {
		poly.addEventListener('keydown',e=>{ // todo
			switch (e.key) {
				case 'ArrowUp':
				case 'ArrowDown':
				case 'ArrowRight':
				case 'Enter':
				break;
				default:
				return;
			}
			e.preventDefault();
		})
		poly.innerHTML = '';
		for (const mChild of mEl.children) {
			const polyChild = c1.dom.fragment('<li>'+mChild.getAttribute('label')).firstChild;
			const icon = mChild.getAttribute('icon');
			if (icon) polyChild.style.backgroundImage = 'url('+icon+')';
			const disabled = mChild.hasAttribute('disabled') || mChild.disabled; // todo: check value of attribute
			if (disabled) {
				polyChild.classList.add('-disabled');
				polyChild.disabled = true;
			}
			polyChild.addEventListener('mouseenter',()=>{ clearTimeout(openTimeout); openTimeout = setTimeout(()=>open(polyChild), 250); })
			polyChild.addEventListener('click', e=>{
				if (e.target !== polyChild) return;
				if (open(polyChild)) return;
				if (!disabled) {
					mChild.dispatchEvent(new Event('click'));
					poly.style.display = 'none';
				}
				e.stopPropagation();
			});
			polyChild.addEventListener('mousedown',  e=>e.stopPropagation())
			polyChild.addEventListener('touchstart', e=>e.stopPropagation())
			poly.append(polyChild);
			mChild.c1RealElement = polyChild;
			if (mChild.children.length) {
				polyChild.classList.add('-sub');
				const ul = c1.dom.fragment('<ul tabindex=0>').firstChild;
				ul.c1Placer = new c1.Placer(ul, {x:'after',y:'prepend',margin:{top:1,right:-3,bottom:1,left:-3}});
				polyChild.append(ul)
				parse(mChild, ul);
			}
		}
		if (poly.id === 'contextMenuePolyfill') {
			const fragment = c1.dom.fragment('<li style="font-size:12px; padding:5px" class=-disabled>shift + rightclick to show the<br> native menu');
			poly.append(fragment);
		}
	}
	let openTimeout;
	function open(polyChild){
		clearTimeout(openTimeout);

		polyChild.parentNode.focus();

		const ul = polyChild.querySelector(':scope >ul');
		if (ul) {
			ul.classList.add('c1-focusIn'); // show before position+focus (display:none blocks both)
			ul.c1Placer.follow(polyChild);
			ul.focus();
			return true;
		}
	}
	const arrow = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="32" fill="none" viewBox="0 0 16 32"><path stroke="#000" stroke-width="2" d="M2 2l12 12L2 26" stroke-linecap="round"/></svg>';

	const css =
	'menu[type=context] {'+
	'	display:none; '+
	'}'+
	'#contextMenuePolyfill, #contextMenuePolyfill ul { '+
	'	position:fixed; '+
	'	display:none; '+
	'	inset:auto; '+
	'	overflow:visible; '+
	'	background:#fff; '+
	'	box-shadow:0 0 8px rgba(0,0,0,.3); '+
	'	list-style:none; '+
	'	font-family:Arial; '+
	'	font-size:15px; '+
	'	margin:0; '+
	'	padding:0; '+
	'	min-width:100px; '+
	'	color:#000; '+
	'	cursor:default; '+
	'	border: 1px solid #aaa; '+
	'} '+
	'#contextMenuePolyfill:popover-open { display:block; opacity:1; transition:none; } '+
	'#contextMenuePolyfill ul.c1-focusIn , '+
	'#contextMenuePolyfill ul:focus-within { '+
	'	display:block; '+
	'} '+
	'#contextMenuePolyfill:focus { outline:none } '+
	'#contextMenuePolyfill li { '+
	'	display:flex; '+
	'	padding:6px 10px 6px 30px; '+
	'	background-position:6px 50%; '+
	'	background-repeat:no-repeat; '+
	'	background-size: 16px 16px; '+
	'} '+
	'#contextMenuePolyfill li:hover, #contextMenuePolyfill li.c1-focusIn , '+
	'#contextMenuePolyfill li:hover, #contextMenuePolyfill li:focus-within { '+
	'	background-color:#f3f3f3; '+
	'} '+
	'#contextMenuePolyfill li.-disabled { '+
	'	opacity:0.36 '+
	'}'+
	'#contextMenuePolyfill li.-sub:after { '+
	'	content:"";'+
	'	flex:1 0 10px;'+
	'	background:url("data:image/svg+xml;utf8,'+encodeURIComponent(arrow)+'") no-repeat 100% 50%;'+
	'	background-size:contain;'+
	'	height:.9em; '+
	'	margin:auto; '+
	'}';
	document.head.prepend(c1.dom.fragment('<style>'+css+'</style>'));
});
