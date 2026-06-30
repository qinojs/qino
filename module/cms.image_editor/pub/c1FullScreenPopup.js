/* Copyright (c) 2016 Tobias Buschor https://goo.gl/gl0mbf | MIT License https://goo.gl/HgajeK */
import { ctx } from '../../core/pub/js/qino.js';

const TAG = 'qino-image-editor';
if (!customElements.get(TAG)) customElements.define(TAG, class extends HTMLElement {});

// Shared CMS chrome (buttons, inputs, --cms-* tokens, icon font) loaded into the
// shadow root, so the editor is styled consistently but isolated from the website.
const styleHrefs = [
    import.meta.resolve('@qino/u2/css/norm/norm.css'),
    import.meta.resolve('@qino/u2/css/base/base.css'),
    'cms/pub/css/ui.css',
];

const baseCss = `
dialog {
    position: fixed;
    inset: 0;
    width: auto; height: auto;
    max-width: none; max-height: none;
    margin: 0; padding: 0; border: 0;
    background: #fff;
    color: var(--cms-dark, #222);
    display: flex;
    flex-flow: column;
}
dialog::backdrop { background: rgba(0, 0, 0, .5); }
`;

// Base: a modal full-screen <dialog> living in an isolated shadow root.
export class c1FullScreenPopup {
    #host;
    #shadow;
    #dialog;

    constructor() {
        this.#host = document.createElement(TAG);
        this.#shadow = this.#host.attachShadow({ mode: 'open' });
        for (const href of styleHrefs) {
            const url = /^https?:/.test(href) ? href : ctx.sysURL + href;
            this.#shadow.append(Object.assign(document.createElement('link'), { rel: 'stylesheet', href: url }));
        }
        this.#shadow.append(Object.assign(document.createElement('style'), { textContent: baseCss }));

        this.#dialog = document.createElement('dialog');
        this.#dialog.className = 'qgCMS';
        this.#shadow.append(this.#dialog);

        // Escape / backdrop → run our own hide() (which may confirm) instead of the default close.
        this.#dialog.addEventListener('cancel', e => { e.preventDefault(); this.hide(); });
    }

    get shadow() { return this.#shadow; }
    /** Currently focused element within the shadow tree (≠ document.activeElement). */
    get activeEl() { return this.#shadow.activeElement; }
    el(selector) { return selector ? this.#dialog.querySelector(selector) : this.#dialog; }

    show() {
        document.body.append(this.#host);
        document.documentElement.style.overflow = 'hidden';
        this.#dialog.showModal();
    }
    hide() {
        document.documentElement.style.overflow = '';
        this.#dialog.close();
        this.#host.remove();
    }
}
