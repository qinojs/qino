/* Copyright (c) 2016 Tobias Buschor https://goo.gl/gl0mbf | MIT License https://goo.gl/HgajeK */
import './onElement.mjs';

c1.accordion = true;
c1.onElement('.c1-accordion', accordion => {
    accordion.addEventListener('click', event => {
        const target = event.target.closest('.c1-accordion > .-trigger');
        if (!target || target.parentNode !== accordion) return;
        const isExpanded = target.getAttribute('aria-expanded') == 'true';
        const singleMode = accordion.hasAttribute('data-singlemode');
        if (singleMode) {
            const triggers = accordion.c1FindAll('> .-trigger');
            triggers.forEach(trigger => {
                if (trigger.getAttribute('aria-expanded') == 'false') return;
				const panel = document.getElementById(trigger.getAttribute('aria-controls'));
				panel.style.height = panel.c1Find('> .-content').offsetHeight+'px';
				setTimeout(() => {
					panel.style.height = '';
					panel.setAttribute('hidden', '');
					trigger.setAttribute('aria-expanded', 'false');
				},10)
            });
        }
        let panel = document.getElementById(target.getAttribute('aria-controls'));

		if (!panel) {
			panel = target.nextElementSibling;
            target.setAttribute('aria-controls', panel.c1Id());
            panel.classList.add('-panel');
            panel.setAttribute('role', 'region');
            panel.setAttribute('aria-labelledby', target.c1Id());
		}

        panel.addEventListener('transitionend',transitionend);
        panel.style.overflow = 'hidden';
        if (isExpanded) {
			panel.style.height = panel.c1Find('> .-content').offsetHeight+'px';
			setTimeout(() => {
                panel.style.height = '';
                panel.setAttribute('hidden', '');
                target.setAttribute('aria-expanded', 'false');
				target.id && history.replaceState('', '', location.pathname+location.search);
            },10);
        } else {
            panel.removeAttribute('hidden');
            const height = panel.c1Find('> .-content').offsetHeight;
			panel.style.height = '0';
            setTimeout(() => {
                panel.style.height = height+'px';
                panel.removeAttribute('hidden');
                target.setAttribute('aria-expanded', 'true');
				target.id && history.replaceState('', '', location.pathname+location.search+'#'+target.id);
            },10);

			if (singleMode) {
				const dur = parseFloat(getComputedStyle(panel).getPropertyValue('transition-duration'))*1000;
				setTimeout(() => {
					import('./scroll.mjs').then(() => target.scrollIntoView({behavior:'smooth'}));
				}, dur);
			}

        }
        event.preventDefault();
    });

    accordion.addEventListener('keydown', event => {
        const target = event.target;
        const key = event.which.toString();
        const ctrlModifier = (event.ctrlKey && key.match(/33|34/));

        if (target.matches('.c1-accordion > .-trigger')) {
            const triggers = accordion.c1FindAll('> .-trigger');
            if (/38|40/.test(key) || ctrlModifier) {
                const index = triggers.indexOf(target);
                const direction = /34|40/.test(key) ? 1 : -1;
                const newIndex = index + direction;
                triggers[newIndex]?.focus();
                event.preventDefault();
            } else if (/35|36|13|32/.test(key)) {
                switch (key) {
                    case '36': triggers[0].focus(); break;
                    case '35': triggers[triggers.length - 1].focus(); break;
                    case '13':
                    case '32':
                        target.dispatchEvent(new MouseEvent('click', {bubbles:true, cancelable:true}));
                }
                event.preventDefault();
            }
        } else if (ctrlModifier) {
            const panel = target.closest('.c1-accordion > .-panel');
            if (panel?.parentNode === accordion) {
                panel.previousElementSibling.focus();
            }
        }
    });
	accordion.addEventListener('mousedown', e => {
		if (e.detail < 2) return;
        const trigger = e.target.closest('.c1-accordion > .-trigger');
        if (!trigger || trigger.parentNode !== accordion) return;
		e.preventDefault();
	})
	if (location.hash) {
		const el = accordion.c1Find('> .-trigger' + location.hash.replace(/[=&"\\]/g, '\\$&') );
		if (el) {
			el.setAttribute('aria-expanded', 'true');
			const panel = document.getElementById(el.getAttribute('aria-controls'));
			panel.removeAttribute('hidden');
		}
	}

});

function transitionend(e){
	e.target.style.height = '';
	e.target.style.overflow = '';
}

export default c1.accordion;
