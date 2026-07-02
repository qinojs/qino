import '../c1/Placer.mjs';

const doc = document;
const dialog = doc.createElement('div');
dialog.classList.add('c1Dialog');
dialog.classList.add('c1Select');
dialog.setAttribute('popover', 'manual'); // top layer: sits above the cms panel (itself a popover) and its shadow DOM
dialog.addEventListener('mousedown', e=>{
	e.preventDefault();
	e.stopPropagation(); // prevent closing cms-panel
});
dialog.addEventListener('touchstart', e => e.stopPropagation()); // prevent closing cms-panel
const Placer = new c1.Placer(dialog);

if (!CSS.supports('overscroll-behavior','contain')) { // zzz if supports
	// console.warn('used?') safari 15.5
	dialog.addEventListener('wheel', e => {
		if (e.wheelDelta > 0 && dialog.scrollTop === 0) {
			e.preventDefault();
		} else if (e.wheelDelta < 0 && dialog.scrollHeight < dialog.scrollTop + dialog.offsetHeight) {
			e.preventDefault();
		}
	});
}

globalThis.c1Combobox = function(input){
	if (input.c1Combobox) return input.c1Combobox;
	input.c1Combobox = this;
	input.setAttribute('autocomplete','off');
	input.addEventListener('input', this);
	input.addEventListener('keydown', this);
	input.addEventListener('blur', this);
	this.input = input;
};
c1Combobox.prototype = {
	showDialog(){
		if (dialog.parentNode !== doc.body) doc.body.append(dialog);
		if (!dialog.matches(':popover-open')) dialog.showPopover(); // top-layer statt z-index, sonst hinter dem panel-popover
		dialog.style.minWidth = this.input.offsetWidth + 'px';
		Placer.follow(this.input);
	},
	hideDialog(){
		if (dialog.matches(':popover-open')) dialog.hidePopover();
	},
	initOptions(){
		this.mark(dialog.firstElementChild);
	},
	searchOptions(){
		console.warn('not implemented');
	},
	searchOptionsDebounced:c1.debounce(function(){
		this.searchOptions();
	}, 150),
	setOptions(array){
		dialog.innerHTML = '';
		let el, i=0, item;
		for (;(item = array[i++]);) {
			el = doc.createElement('div');
			el.innerHTML = item.html;
			el.setAttribute('value', item.value);
			el.setAttribute('text', item.text);
			dialog.appendChild(el);
		}
		this.initOptions();
	},
	mark(el){
		this.marked?.classList?.remove('-marked');
		this.marked = el;
		el?.classList?.add('-marked');
	},
	select(el){
		if (!el) return;
		this.mark(el);
		this.selected = el;
		this.input.value = el.getAttribute('value');
		this.input.dispatchEvent(new Event('change',{bubbles:true})); // should trigger "input" only, cause focus is on input
		if (el.offsetTop + el.offsetHeight > dialog.scrollTop + dialog.offsetHeight - 10) {
			dialog.scrollTop = el.offsetTop + el.offsetHeight - dialog.offsetHeight + 4;
		}
		if (el.offsetTop < dialog.scrollTop + 10) {
			dialog.scrollTop = el.offsetTop - 2;
		}
	},
	handleEvent(e){
		if (!this['on'+e.type]) return;
		this['on'+e.type](e);
	},
	onfocus(){
		this.input.select();
		setTimeout(()=>{ // ie11 has blur before focusin
			dialog.innerHTML = '';
			this.lastValue = this.input.value;
			this.showDialog();
			this.searchOptions();
			dialog.onmouseover = e=>{ // neu
				const el = e.target.closest('[value]');
				this.mark(el);
			};
			dialog.onmouseup = e=>{
				const el = e.target.closest('[value]');
				this.select(el);
				this.hideDialog(); // neu
				this.input.dispatchEvent(new CustomEvent('select_by_pointer')); // new
			};
			dialog.c1Combobox = this;
		});
	},
	onblur(){
		dialog.c1Combobox = false;
		this.hideDialog();
	},
	oninput(){
		this.showDialog();
		this.searchOptionsDebounced();
	},
	onkeydown(e) {
		if (e.defaultPrevented) return;
		switch (e.key) {
		case 'ArrowDown':
			this.marked && this.select(this.marked.nextElementSibling);
			return;
		case 'ArrowUp':
			this.marked && this.select(this.marked.previousElementSibling);
			return;
		case 'Enter': // preventDefault() ??
			this.marked && this.select(this.marked);
			this.hideDialog();
			return;
		case 'Escape':
			this.input.value = this.lastValue;
			this.hideDialog();
			return;
		}
	}
};

const css =
'.c1Select { \
	position: fixed; \
	inset: auto; \
	margin: 0; \
	padding: 0; \
	font-size: 13px; \
	background-color:#fff; \
	border: 1px solid #aaa; \
	overflow: auto; \
	overscroll-behavior: contain; \
	left: 0px; \
	white-space:nowrap; \
	line-height:1.2; \
	box-shadow: 0 0 8px rgba(0,0,0,.3); \
	min-height: 10px; \
	max-height: 50vh; \
	box-sizing:border-box; \
	cursor:pointer; \
} \
.c1Select > div { \
	padding:4px 6px; \
	margin:2px; \
} \
.c1Select > .-marked { \
	background-color:#0099ff; \
	color:#fff; \
} \
.c1Select::-webkit-scrollbar { width: 6px; height: 6px; } \
.c1Select::-webkit-scrollbar-track { background: rgba(0, 0, 0, .05); } \
.c1Select::-webkit-scrollbar-thumb { background: rgba(0, 0, 0, .25); } \
';
const sEl = document.createElement('style');
sEl.textContent = css;
document.head.append(sEl);
