/* Widget kernel. A widget is one module that owns its content, behaviour and style.
  * It renders no frame: `head` and `badge` are announced, and whoever mounted the widget
  * decides how to show them — as a panel accordion, or not at all.
  *
  * Widgets are created in code only: activation lives in a WeakMap, never in an attribute,
  * so a <qcms-widget> arriving through injected html has no source and stays inert. */
import { html } from '@qino/pub/html.js';

const states = new WeakMap();
const adopted = new WeakMap(); // root -> srcs already adopted there

// The stylesheet follows the mount point, so a widget works in the panel, in a dialog
// or straight in the page — the kernel knows nothing about any of them.
const adopt = (el, src, css) => {
  const root = el.getRootNode();
  if (!css || !root.adoptedStyleSheets) return;
  const seen = adopted.get(root) ?? adopted.set(root, new Set()).get(root);
  if (seen.has(src)) return;
  seen.add(src);
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(css);
  root.adoptedStyleSheets.push(sheet);
};

class Widget extends HTMLElement {
  #head = null; #badge = null;

  connectedCallback() {
    const s = states.get(this);
    if (!s) return; // not created by widget(): no source, nothing
    run(s);
  }
  disconnectedCallback() {
    const s = states.get(this);
    if (s) stop(s);
  }

  /** Head text. Accepts a promise, so t`` works straight. */
  set head(v) { Promise.resolve(v).then((text) => { this.#head = text; this.#announce(); }); }
  get head() { return this.#head; }

  /** The marker next to the head: a value, or `[{ text, class }, …]` for several.
    * Falsy means none; set it any time, no re-render. */
  set badge(v) { this.#badge = v; this.#announce(); }
  get badge() { return this.#badge; }

  #announce() {
    this.dispatchEvent(new CustomEvent('qcms-widget-head', {
      bubbles: true,
      detail: { head: this.#head, badge: this.#badge },
    }));
  }

  /** Run the module again, optionally against a new context. */
  reload(context) {
    const s = states.get(this);
    if (!s) return;
    if (context) s.context = context;
    return run(s);
  }

  /** Content, through the server's html`` builder — interpolated promises are awaited. */
  html(strings, ...values) {
    return html.async(strings, ...values).then((h) => { this.innerHTML = h; return this; });
  }

  /** Listener on the content, dropped automatically on reload and disconnect.
    * With a selector it is delegated: `on(type, selector, fn)`; without: `on(type, fn)`. */
  on(type, selector, fn) {
    if (!fn) [selector, fn] = [null, selector];
    const signal = states.get(this)?.abort?.signal;
    this.addEventListener(type, (e) => {
      const el = selector ? e.target.closest?.(selector) : this;
      if (el) fn(el, e);
    }, { signal });
  }
}
customElements.define('qcms-widget', Widget);

async function stop(s) {
  s.gen++;
  s.abort?.abort();
  s.abort = null;
  const cleanup = s.cleanup;
  s.cleanup = null;
  await Promise.resolve(cleanup?.()).catch((err) => console.error('widget cleanup failed', s.src, err));
}

async function run(s) {
  await stop(s);
  const gen = s.gen;
  const signal = (s.abort = new AbortController()).signal;
  try {
    const mod = await import(s.src);
    if (gen !== s.gen) return; // a newer run took over while we waited
    adopt(s.el, s.src, mod.css);
    const cleanup = await mod.default(s.el, { ...s.context, signal });
    if (gen !== s.gen) await cleanup?.();
    else s.cleanup = cleanup;
  } catch (err) {
    if (gen !== s.gen || err?.name === 'AbortError') return;
    console.error('widget failed', s.src, err);
    s.el.html`<u2-alert open variant=error>${err?.message ?? String(err)}</u2-alert>`;
  }
}

/** Create a widget from its module url; `context` is handed to the module unchanged. */
export function widget(src, context = {}) {
  const el = document.createElement('qcms-widget');
  states.set(el, { el, src: new URL(src, import.meta.url).href, context, gen: 0, abort: null, cleanup: null });
  return el; // runs on connect
}
