/* Copyright (c) 2016 Tobias Buschor https://goo.gl/gl0mbf | MIT License https://goo.gl/HgajeK */
import { addCmsStyles, addCss } from '../../cms/pub/js/styles.js';

const TAG = 'qino-image-editor';
if (!customElements.get(TAG)) customElements.define(TAG, class extends HTMLElement {});

// Full-screen layout; overrides ui.css's centered-box dialog rule (`:host dialog`),
// hence the higher-specificity `dialog.qgCMS` selectors.
const BASE_CSS = `
dialog.qgCMS {
    position: fixed;
    inset: 0;
    width: auto; height: auto;
    max-width: none; max-height: none;
    margin: 0; padding: 0; border: 0;
    border-radius: 0; min-width: 0; box-shadow: none;
    background: #fff;
    color: var(--cms-dark, #222);
    display: flex;
    flex-flow: column;
}
dialog.qgCMS > * { padding: 0; }
dialog.qgCMS::backdrop { background: rgba(0, 0, 0, .5); }
`;

// Base: a modal full-screen <dialog> living in an isolated shadow root.
export class FullScreenDialog {
    #host;
    #shadow;
    #dialog;

    constructor() {
      this.#host = document.createElement(TAG);
      this.#shadow = this.#host.attachShadow({ mode: 'open' });
      addCmsStyles(this.#shadow);          // shared chrome: tokens, buttons, inputs, icon font
      addCss(this.#shadow, BASE_CSS);      // same queue -> stays after ui.css in the cascade

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
