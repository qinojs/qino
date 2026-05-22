c1.c1Use(['focusIn','onElement'],function(){ 'use strict';

	if (c1.dialog) { console.log('c1.dialog loaded once more'); return; }

    document.head.prepend(c1.dom.fragment(`<style>
    .c1-dialog.c1-dialog { display:none; }
    .c1-dialog {
        position:fixed; flex-flow:column; box-sizing:border-box; overflow:auto; background:#fff;
        max-width:100vw; max-height:100vh; padding:1em;
        top:20%; left:50%; transform:translateY(-20%) translateX(-50%);
    }
    .c1-dialog.c1-focusIn { display:block; display:flex; }
    .c1-dialog:focus-within { display:block; }
    .c1-dialog.c1-box:focus-within { display:flex; }
    .c1-dialog.c1-box > .-body { overscroll-behavior:none; }
    </style>`));

    function open(el){
        el.dispatchEvent(new CustomEvent('c1-dialog-open',{bubbles:true,cancelable:true})); // cancelable needed?
        setTimeout(() => backdrop.for(el));
    }
    function close(el){
        backdrop.hide();
		el.dispatchEvent(new CustomEvent('c1-dialog-close',{bubbles:true,cancelable:true})); // cancelable needed?
    }
    c1.onElement('.c1-dialog', el => {
        el.setAttribute('tabindex','0');
        el.contains(document.activeElement) && open(el);
        el.addEventListener('focusin', () => open(el));
        el.addEventListener('focusout', () => {
            setTimeout(() => { // wait for new document.activeElement
                if (el.contains(document.activeElement)) return;
                close(el);
            });
        });
        el.addEventListener('keydown', e => {
            if (e.which !== 27 && e.target !== el) return;
            e.target.blur();
        });
        el.addEventListener('c1-close', e => {
            const active = document.activeElement;
            el.contains(active) && active.blur();
			e.preventDefault();
            e.stopPropagation();
            close(el);
        });
        const stopPropagation = e => e.stopPropagation();
        el.addEventListener('touchstart', stopPropagation);
		el.addEventListener('mousedown', stopPropagation);
    });

    c1.dialog = function(options){
        const str =
		'<form class="c1-dialog c1-box q1Rst" tabindex=0>'+
        '	<div class=-head>'+
		'		<div class=-title>'+options.title+'</div>'+
		'	</div>'+
        (options.body?
        '	<div class=-body>'+options.body+'</div>':'')+
        (options.foot||options.buttons?
        '	<div class=-foot>'+
        '		<div class=-buttons style="xmargin:-.4em; flex:1; display:flex; flex-wrap:wrap; justify-content: flex-end;"></div>'+
		'	</div>':'')+
		'</form>';
		const element = this.element = c1.dom.fragment(str).firstChild;
        if (options.class) element.className += ' '+options.class;
		const btnCont = element.c1Find('>.-foot>.-buttons');
		element.addEventListener('submit', e => e.preventDefault());
        options.buttons?.forEach((btn, i) => {
            const el = document.createElement('button');
            el.innerHTML = btn.title;
            el.style.margin = '.4em';
            el.style.minWidth = '5em';
            el.addEventListener('click', e => {
                btn.then?.call?.(el, e);
                element.focus(); // not needed in chrome
                element.blur(); // ie11
                element.remove();
            });
            btnCont.appendChild(el);
            if (i === 0) setTimeout(() => el.focus());
        });
    };
    c1.dialog.prototype = {
        show:function(){
            const element = this.element;
            document.body.appendChild(element);
    		element.c1ZTop();
            element.c1Focus();
            return new Promise(resolve => {
                element.addEventListener('c1-dialog-close', e => {
					console.log('event comes twice?')
                    if (element !== e.target) return;
                    resolve(this.value);
                });
            });
        },
        hide:function(){
    		this.element.dispatchEvent(new CustomEvent('c1-close',{bubbles:true,cancelable:true}));
        }
    };

    c1.dialog.alert = function(body, options = {}) {
        const dialog = new c1.dialog({
            title: options.title || 'Hinweis',
            body:body,
            buttons:[{title:'ok'}]
        });
        return dialog.show();
    };
    c1.dialog.confirm = function(title) {
        const dialog = new c1.dialog({
            title:'Confirm',
            body:title,
            buttons:[{
                title:'ok', then:() => { dialog.value = true; }
            },{title:'abbrechen'}]
        });
        dialog.value = false;
        return dialog.show();
    };
    c1.dialog.prompt = function(title) {
        const dialog = new c1.dialog({
            title:'Eingabe',
            body: title+'<br><input style="width:20em; max-width:100%">',
            buttons:[{
                title:'ok', then:() => { dialog.value = input.value; }
            },{title:'schliessen'}]
        });
        const input = dialog.element.c1Find('input');
        setTimeout(() => input.focus());
        dialog.value = null;
        return dialog.show();
    };


    /* HELPERS */

    /* backdrop */
    const bdDiv = document.createElement('div');
    bdDiv.style.cssText = 'position:fixed; top:-70px; left:0; bottom:0; right:0; background:rgba(0,0,0,.4); transition:opacity .16s linear; opacity:0'; // top:-70px => addressbar toggle on scroll
	bdDiv.className = 'c1-backdrop';
    let bdTimeout = null;
    const backdrop = {
        for:function(el){
            clearTimeout(bdTimeout);
            el.before(bdDiv);
            bdDiv.c1ZTop();
            bdDiv.style.opacity = 0;
            requestAnimationFrame(() => {
                bdDiv.style.pointerEvents = '';
                bdDiv.style.opacity = 1;
            });
            el.c1ZTop();
        },
        hide:function(){
            bdDiv.style.opacity = 0;
            bdTimeout = setTimeout(() => bdDiv.remove(), 300);
        }
    };
    bdDiv.addEventListener('mousedown', e => e.stopPropagation(), true);
    bdDiv.addEventListener('touchstart',e => e.stopPropagation(), true);

    /* close */
    function listenClose(e){
		const btn = e.target.closest('.c1-close');
		if (!btn) return;
		close(btn);
		btn.dispatchEvent(new CustomEvent('c1-close',{bubbles:true,cancelable:true}));
		e.preventDefault();
	}
	document.addEventListener('mousedown',listenClose);
	document.addEventListener('touchstart',listenClose);
});
