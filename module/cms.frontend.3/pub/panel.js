import { cms, h, t, widgetScope } from "./cms.js";
import { initContextMenu } from "./context-menu.js";

const current = globalThis.qino?.cms?.nodeId;
if (current) {
  const host = h("qino-cms", { "aria-label": "CMS", "data-open": true, hidden: true });
  const root = host.attachShadow({ mode: "open" });
  const styles = [
    import.meta.resolve("@qino/u2/css/norm/norm.css"),
    import.meta.resolve("@qino/u2/css/base/base.css"),
    new URL("../../cms/pub/css/ui.css", import.meta.url),
    new URL("./panel.css", import.meta.url),
  ];
  const [openLabel, exitLabel, settingsLabel] = await Promise.all([t`Open`, t`Exit CMS`, t`Settings`]);
  const nodeInput = h("input", { type: "number", min: 1, value: current, title: "Node ID" });
  const title = h("strong", {}, `CMS · ${current}`);
  const form = h("form", {}, nodeInput, h("button", { type: "submit" }, openLabel));
  const head = h("header", {}, title, form);
  const body = h("main");
  const exit = h("button", { type: "button", class: "-exit", title: exitLabel, "aria-label": exitLabel }, h("i"));
  const tab = h("button", {
    type: "button",
    class: "-tab -active",
    title: settingsLabel,
    "aria-label": settingsLabel,
    "aria-expanded": "true",
  }, h("span", {}, settingsLabel));
  const rail = h("nav", { class: "-rail", "aria-label": "CMS" }, exit,
    tab,
  );
  const panel = h("div", { class: "-panel" }, h("section", { class: "-content" }, head, body), rail);
  root.append(...styles.map(href => h("link", { rel: "stylesheet", href })), panel);
  document.body.append(host);
  requestAnimationFrame(() => host.hidden = false);

  const { scope: dialogScope } = await import("@qino/u2/js/dialog/dialog.js");
  const isolate = el => ["click", "mousedown", "touchstart"].forEach(type => el.addEventListener(type, event => event.stopPropagation()));
  const scoped = dialogScope({ root, init: isolate });
  cms.dialogs = {
    ...scoped,
    alert: async text => scoped.alert(await text),
    confirm: async text => scoped.confirm(await text),
    prompt: async (text, initial) => scoped.prompt(await text, initial),
  };

  const widget = widgetScope(root);
  const settings = widget(new URL("./widgets/settings.js", import.meta.url), { node: { id: current } });
  const media = widget(new URL("./widgets/media.js", import.meta.url), { node: { id: current } });
  body.append(settings, media);

  let active = document.querySelector(`[qcms-id="${CSS.escape(String(current))}"]`);
  active?.setAttribute("data-cms-active", "");
  let activeId = Number(current);
  const open = value => {
    host.toggleAttribute("data-open", value);
    tab.classList.toggle("-active", value);
    tab.setAttribute("aria-expanded", String(value));
  };
  const select = (id, reveal = true) => {
    id = Number(id);
    if (!id) return;
    if (reveal) open(true);
    if (id === activeId) return;
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
  tab.addEventListener("click", () => open(!host.hasAttribute("data-open")));
  exit.addEventListener("click", () => {
    const url = new URL(location.href);
    url.searchParams.set("cms_editmode", "0");
    location.href = url;
  });
  document.addEventListener("click", event => {
    if (event.composedPath().includes(host)) return;
    const node = event.target.closest?.("[qcms-id]");
    if (node) select(node.getAttribute("qcms-id"));
  });

  const menu = initContextMenu({ dialogs: cms.dialogs, select });

  cms.panelRoot = root;
  cms.panel = { host, root, el: panel, contextMenu: menu, open, select };
}
