import { cms, h, setDialogScope, t, widgetScope } from "./cms.js";
import { addStyle, shell } from "./shell.js";

const current = globalThis.qino?.cms?.nodeId;
if (current) {
  const { host, root } = shell();
  host.setAttribute("data-open", "");
  addStyle(root, new URL("./panel.css", import.meta.url));
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
  root.append(panel);

  const { scope: dialogScope } = await import("@qino/u2/js/dialog/dialog.js");
  const isolate = el => ["click", "mousedown", "touchstart"].forEach(type => el.addEventListener(type, event => event.stopPropagation()));
  const scoped = dialogScope({ root, init: isolate });
  setDialogScope(scoped);

  const widget = widgetScope(root);
  const settings = widget(new URL("./widgets/settings.js", import.meta.url), { node: { id: current } });
  const media = widget(new URL("./widgets/media.js", import.meta.url), { node: { id: current } });
  body.append(settings, media);

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
    settings.reload({ node: { id } });
    media.reload({ node: { id } });
  };

  form.addEventListener("submit", event => {
    event.preventDefault();
    cms.select(nodeInput.value);
  });
  document.addEventListener("cms:select", event => select(event.detail.id));
  document.addEventListener("mousedown", event => {
    if (event.button === 0 && !event.composedPath().includes(host)) open(false);
  });
  document.addEventListener("keydown", event => {
    const target = event.composedPath()[0];
    if (target.getRootNode() !== document || target.isContentEditable || target.form !== undefined ||
      event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;
    if (event.key === "Escape") open(false);
    if (event.key === " ") {
      cms.select(cms.contents?.active?.getAttribute("qcms-id") || activeId);
      event.preventDefault();
    }
  });
  tab.addEventListener("click", () => open(!host.hasAttribute("data-open")));
  exit.addEventListener("click", () => {
    const url = new URL(location.href);
    url.searchParams.set("cms_editmode", "0");
    location.href = url;
  });
  cms.panelRoot = root;
  cms.panel = { host, root, el: panel, open, select: cms.select, widgets: { media, settings } };
  document.dispatchEvent(new Event("cms:panel-ready"));
  if (cms.selected && cms.selected !== Number(current)) select(cms.selected);
}
