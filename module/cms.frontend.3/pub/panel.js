import { cms, h, widgetScope } from "./cms.js";

const current = globalThis.qino?.cms?.nodeId;
if (current) {
  const host = h("qino-cms", { "aria-label": "CMS", hidden: true });
  const root = host.attachShadow({ mode: "open" });
  const styles = [
    import.meta.resolve("@qino/u2/css/norm/norm.css"),
    import.meta.resolve("@qino/u2/css/base/base.css"),
    new URL("../../cms/pub/css/ui.css", import.meta.url),
    new URL("./panel.css", import.meta.url),
  ];
  const nodeInput = h("input", { type: "number", min: 1, value: current, title: "Node ID" });
  const title = h("strong", {}, `CMS · ${current}`);
  const form = h("form", {}, nodeInput, h("button", { type: "submit" }, "Open"));
  const head = h("header", {}, title, form, h("button", { type: "button", class: "-exit" }, "Exit"));
  const body = h("main");
  root.append(...styles.map(href => h("link", { rel: "stylesheet", href })), head, body);
  document.body.append(host);
  requestAnimationFrame(() => host.hidden = false);

  const widget = widgetScope(root);
  const settings = widget(new URL("./widgets/settings.js", import.meta.url), { node: { id: current } });
  const media = widget(new URL("./widgets/media.js", import.meta.url), { node: { id: current } });
  body.append(settings, media);

  let active;
  let activeId = Number(current);
  const select = id => {
    id = Number(id);
    if (!id || id === activeId) return;
    activeId = id;
    nodeInput.value = id;
    title.textContent = `CMS · ${id}`;
    active?.removeAttribute("data-cms-active");
    active = document.querySelector(`[qcms-id="${CSS.escape(String(id))}"]`);
    active?.setAttribute("data-cms-active", "");
    settings.reload({ node: { id } });
    media.reload({ node: { id } });
  };

  form.addEventListener("submit", event => {
    event.preventDefault();
    select(nodeInput.value);
  });
  head.querySelector(".-exit").addEventListener("click", () => {
    const url = new URL(location.href);
    url.searchParams.set("cms_editmode", "0");
    location.href = url;
  });
  document.addEventListener("click", event => {
    if (event.composedPath().includes(host)) return;
    const node = event.target.closest?.("[qcms-id]");
    if (node) select(node.getAttribute("qcms-id"));
  });

  cms.panelRoot = root;
  cms.panel = { host, root, select };
}
