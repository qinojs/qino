/* Copyright (c) 2016 Tobias Buschor https://goo.gl/gl0mbf | MIT License https://goo.gl/HgajeK */
//import '../c1/Placer.mjs';
import './Rte.mjs';

window.Rte.ui = {
	init() {
		const my = this;
		my.div = document.createElement('div');
		my.div.id = 'qgRteToolbar';
		my.div.addEventListener('mousedown',  e=>e.stopPropagation());
		my.div.addEventListener('touchstart', e=>e.stopPropagation());

		Rte.addUiElement(my.div);

		my.mainContainer = document.createElement('div');
		my.mainContainer.className = '-main';
		my.div.appendChild(my.mainContainer);

		my.moreContainer = document.createElement('div');
		my.moreContainer.className = '-more';
		my.div.appendChild(my.moreContainer);

		Rte.on('activate', function() {
			const config = Rte.ui.config['rteDef']; // todo
			my.activeItems = {};
			let appendTo = my.mainContainer;
			const addItem = (n) => {
				if (!my.items[n]) return;
				my.activeItems[n] = my.items[n];
				appendTo.appendChild(my.items[n].el);
			};
			config.main.forEach(addItem);
			appendTo = my.moreContainer;
			config.more.forEach(addItem);
			if (my.activeItems) {
				document.body.appendChild(my.div);
				my.div.style.display = 'block';
				my.div.style.opacity = '0';
				my.div.style.pointerEvents = 'none';
				Rte.ui.mouseover = 0;
				setTimeout(()=>{
					my.div.c1ZTop();
					my.div.style.opacity = '1';
					my.div.style.pointerEvents = '';
				},100);
				document.addEventListener('keydown', shortcutListener, false);
			}
		});
		Rte.on('deactivate', function() {
			document.removeEventListener('keydown', shortcutListener, false);
			setTimeout(()=>{ // need timeout because inputs inside have to blur first (ff, no chrome)
				!Rte.active && my.div.parentNode && document.body.removeChild(my.div);
			},1);
		});
		//Rte.on('elementchange', function() {
		Rte.on('selectionchange', function() { // new 10.1.18, item.enable has to check on selectionchange
			//if (!Rte.element) return; needed?
			for (const [_name, item] of Object.entries(my.activeItems)){
				if (!item.enable || item.enable(Rte.element)) {
					item.enabled = true;
					item.el.removeAttribute('hidden');
					item.check && item.el.classList.toggle('active', !!item.check(Rte.element) );
				} else {
					item.enabled = false;
					item.el.setAttribute('hidden',true);
				}
			}
		});
		const shortcutListener = function(e) {
			if (e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey) {
				console.log(e.key)
				const char = e.key;
				for (const [_name, item] of Object.entries(my.activeItems)){
					if (item.enabled && item.shortcut === char) {
						const event = new MouseEvent('mousedown',{'bubbles': true,'cancelable': true});
						item.el.dispatchEvent(event);
		                e.preventDefault();
					}
				}
			}
		};
		/* ui hover */
		let moreTimeout = null;
		my.div.addEventListener('mouseenter',()=>{
			clearTimeout(moreTimeout);
			moreTimeout = setTimeout(()=>{
				Rte.ui.div.querySelector('.-more').classList.add('-show');
			},300);
			Rte.ui.mouseover = 1;
		});
		my.div.addEventListener('mouseleave',()=>{
			clearTimeout(moreTimeout);
			moreTimeout = setTimeout(()=>{
				Rte.ui.div.querySelector('.-more').classList.remove('-show');
			},300);
			Rte.ui.mouseover = 0;
		});
	},
	setItem(name, opt) {
		if (!opt.el) {
			opt.el = document.createElement('span');
			opt.el.className = '-item -'+name;
		}
		if (opt.cmd) {
			opt.click ??= ()=>qgExecCommand(opt.cmd, false);
			opt.check ??= ()=>qgQueryCommandState(opt.cmd);
		}
		const enable = opt.enable;
		if (enable && enable.toLowerCase) {
			opt.enable = el => el?.matches?.(enable);
			// opt.enable = el => { // todo?
			// 	if (!el) return false;
			// 	let target = el.closest(enable);
			// 	return Rte.active !== target && Rte.active.contains(target);
			// }
		}
		opt.click && opt.el.addEventListener('mousedown',e=>{
			Rte.manipulate( ()=>opt.click(e) ); // todo: manipulate schon hier??
		}, false);
		opt.shortcut && opt.el.setAttribute('title','ctrl+'+opt.shortcut);
		this.items[name] = opt;
		return opt.el;
	},
	setSelect(name, opt) {
		let timeout = null;
		const el = c1.dom.fragment('<div class="-item -select"><div class=-state></div><div class=-options></div></div>').firstChild;
		el.addEventListener('mousedown', e=> { opts.style.display = 'block'; e.preventDefault(); });
		el.addEventListener('mouseover', e=> clearTimeout(timeout) );
		el.addEventListener('mouseout',  e=> timeout = setTimeout(()=> opts.style.display = 'none' ,300) );
		const opts = el.c1Find('>.-options');
		opt.el = el;
		this.setItem(name,opt);
		return opts;
	},
	items:{}
};

Rte.ui.init();

Rte.on('selectionchange', async ()=>{
	if (!Rte.active) return;
	if (Rte.ui.mouseover) return;
	const margin = getSelection().isCollapsed ? 100 : 20;
	await import('./../c1/Placer.mjs');
	const placer = new c1.Placer(Rte.ui.div, {
		x:'center',
		y:'after',
		margin,
	});
	placer.toClientRect(qgSelection.rect());
});
