import { cms, h } from "./cms.js";

if (!customElements.get("qino-cms")) customElements.define("qino-cms", class extends HTMLElement {});

export function shell() {
  if (cms.root) return { host: cms.host, root: cms.root };
  const host = document.querySelector("qino-cms[data-cms-shell]") || h("qino-cms", { "data-cms-shell": true, "aria-label": "CMS" });
  const root = host.shadowRoot || host.attachShadow({ mode: "open" });
  root.append(
    h("link", { rel: "stylesheet", href: import.meta.resolve("@qino/u2/css/norm/norm.css") }),
    h("link", { rel: "stylesheet", href: import.meta.resolve("@qino/u2/css/base/base.css") }),
    h("link", { rel: "stylesheet", href: new URL("../../cms/pub/css/ui.css", import.meta.url) }),
  );
  if (!host.isConnected) document.body.append(host);
  cms.host = host;
  cms.root = root;
  return { host, root };
}

export function addStyle(root, href) {
  const url = String(href);
  if (!root.querySelector(`link[href="${CSS.escape(url)}"]`)) root.append(h("link", { rel: "stylesheet", href: url }));
}
