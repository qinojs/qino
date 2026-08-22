import { api, ctx, t } from "@qino/pub/qino.js";
import { cms } from "@qino/m/cms/pub/js/cms.mjs";

export { api, ctx, t };
export { cms };

export function h(name, attrs = {}, ...children) {
  const el = document.createElement(name);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key === "class") el.className = value;
    else if (key in el) el[key] = value;
    else el.setAttribute(key, value === true ? "" : value);
  }
  el.append(...children.flat(Infinity).filter(v => v != null && v !== false));
  return el;
}

const moduleUrl = src => {
  const url = new URL(src, location.href);
  const base = new URL(ctx.moduleUrl, location.href);
  const path = url.pathname.slice(base.pathname.length);
  if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname) || !/^[^/]+\/pub\/.+/.test(path)) {
    throw new TypeError(`Invalid widget URL: ${url}`);
  }
  return url;
};

/** Bind the generic widget factory to one trusted CMS root. */
export function widgetScope(root) {
  const states = new Set();
  const styles = new Map();

  const addCss = (url, css) => {
    if (!css || styles.has(url)) return;
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css.replaceAll("qino-cms ", ""));
    root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
    styles.set(url, sheet);
  };

  const stop = async state => {
    state.run++;
    state.abort?.abort();
    state.abort = null;
    const cleanup = state.cleanup;
    state.cleanup = null;
    try { await cleanup?.(); }
    catch (error) { console.error("CMS widget cleanup failed", state.url, error); }
  };

  const run = async state => {
    await stop(state);
    const run = state.run;
    const abort = state.abort = new AbortController();
    try {
      const mod = await import(state.url);
      if (run !== state.run) return;
      if (typeof mod.default !== "function") throw new TypeError(`Widget has no default export: ${state.url}`);
      addCss(state.url, mod.css);
      const cleanup = await mod.default(state.el, { ...state.context, signal: abort.signal });
      if (run !== state.run) await cleanup?.();
      else {
        state.cleanup = typeof cleanup === "function" ? cleanup : null;
        state.el.dispatchEvent(new Event("load"));
      }
    } catch (error) {
      if (run !== state.run || error?.name === "AbortError") return;
      console.error("CMS widget failed", state.url, error);
      const event = new ErrorEvent("error", { error, message: error?.message, cancelable: true });
      if (state.el.dispatchEvent(event)) state.el.replaceChildren(h("u2-alert", { open: true, variant: "error" }, error?.message || String(error)));
    }
    return state.el;
  };

  const sync = () => {
    for (const state of states) {
      if (root.contains(state.el)) {
        if (!state.connected) {
          state.connected = true;
          run(state);
        }
      } else if (state.connected) {
        state.connected = false;
        stop(state);
        states.delete(state);
      }
    }
  };

  new MutationObserver(sync).observe(root, { childList: true, subtree: true });

  cms.widget = (src, context = {}) => {
    const url = moduleUrl(src).href;
    const el = h("div");
    const state = { el, url, context, connected: false, run: 0, abort: null, cleanup: null };
    states.add(state);
    Object.defineProperty(el, "reload", {
      value: (next = state.context) => {
        state.context = next;
        return root.contains(el) ? run(state) : Promise.resolve(el);
      },
    });
    queueMicrotask(sync);
    return el;
  };

  return cms.widget;
}
