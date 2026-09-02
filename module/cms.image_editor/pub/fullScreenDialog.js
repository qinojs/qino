/* Copyright (c) 2016 Tobias Buschor https://goo.gl/gl0mbf | MIT License https://goo.gl/HgajeK */

// Full-screen layout. Surroundings tend to style dialogs as centered boxes; css() nests this
// under the element, which lifts it above such a rule.
const BASE_CSS = `
dialog.-fullscreen {
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

    & > * { padding: 0; }
    &::backdrop { background: rgba(0, 0, 0, .5); }
}
`;

/** Base: a modal full-screen <dialog>. Append it where it should live — in a shadow root it
  * uses that root's styles, in the document it isolates itself in an own one. */
export class FullScreenDialog extends HTMLElement {
    #dialog;

    // Overwrite with scoped ones to match the surroundings. bind: the browser's own refuse a
    // foreign `this`.
    alert = globalThis.alert.bind(globalThis);
    confirm = globalThis.confirm.bind(globalThis);

    connectedCallback() { this.#build(); }

    // Built on connect, so it can take the styles of the root it was appended to. Unconnected
    // (nobody placed it) it isolates itself, which is what show() falls back to anyway.
    #build() {
      if (this.#dialog) return;
      if (!(this.getRootNode() instanceof ShadowRoot)) this.attachShadow({ mode: 'open' });

      this.#dialog = document.createElement('dialog');
      this.#dialog.className = '-fullscreen';
      this.#root.append(this.#dialog);
      this.css(BASE_CSS); // first style added, so later ones win

      // Escape / backdrop → run our own hide() (which may confirm) instead of the default close.
      this.#dialog.addEventListener('cancel', e => { e.preventDefault(); this.hide(); });
    }

    // our own shadow root, or the tree we were placed in
    get #root() { return this.shadowRoot ?? this; }

    /** Add css. Nested under the element, as the root may be a shared tree. */
    css(text) {
      this.#build();
      const style = document.createElement('style');
      style.textContent = `${this.shadowRoot ? ':host' : this.localName} { ${text} }`; // in a foreign root `:host` is its host
      this.#root.append(style);
    }
    /** Link a stylesheet. Only for the isolated case — a shared root brings its own. */
    addStyle(href) {
      this.#build();
      this.#root.append(Object.assign(document.createElement('link'), { rel: 'stylesheet', href }));
    }

    /** Currently focused element within our tree (≠ document.activeElement). */
    get activeEl() { return this.#root.getRootNode().activeElement; }
    el(selector) {
      this.#build();
      return selector ? this.#dialog.querySelector(selector) : this.#dialog;
    }

    show() {
      this.isConnected || document.body.append(this);
      document.documentElement.style.overflow = 'hidden';
      this.#dialog.showModal();
    }
    hide() {
      document.documentElement.style.overflow = '';
      this.#dialog.close();
      this.remove();
    }
}
