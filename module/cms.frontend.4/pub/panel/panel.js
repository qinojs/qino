import { itemJs } from "@qino/pub/SettingsEditor.mjs";
import { api, t, ctx } from "@qino/pub/qino.js";

import { root } from "../js/root.js";
import { widget as mountWidget } from "./widget.js";
import { onShortcut } from "../js/shortcut.js";
import "./contentMenu.js";

const nodeId = globalThis.qino?.cms?.nodeId;
const activeId = () => cms.cont.active || nodeId;

root.host.addStyle("cms.frontend.4/pub/panel/panel.css");
root.host.addStyle("cms.frontend.4/pub/panel/tree.css");

const on = (el, events, fn) => events.split(" ").forEach(e => el.addEventListener(e, fn));
const sel = s => s[0] === ">" ? ":scope " + s : s;
const findEl = (el, s) => el.querySelector(sel(s));
const findAll = (el, s) => el.querySelectorAll(sel(s));
function setHtml(el, html) {
  el.innerHTML = html;
  for (const s of el.querySelectorAll("script")) console.warn("Script tag in CMS widget HTML", s);
}
function setSetting(value, path) {
  const p = Array.isArray(path) ? path : String(path || "").split("/").filter(Boolean);
  return api.core["ctx-settings"](p).put({ value });
}

const { item } = await itemJs;
const uiState = item(globalThis.qino?.cms?.ui ?? {});
const sidebar = uiState.item("sidebar");
const widgets = uiState.item("widget");
if (!widgets.filled) widgets.set({});

cms.panel = { state: uiState, sidebar, widgets };
cms.panelRoot = root;
const el = root.getElementById("panel");
el.showPopover();

// A failed <img> fires no bubbling event, so the media list is listened to at the root.
root.addEventListener("error", (e) => {
  const src = e.target?.dataset?.audio;
  if (!src) return;
  e.target.replaceWith(Object.assign(document.createElement("audio"), {
    src, controls: true, draggable: true, style: "min-width:calc(var(--rem) * 4.4); width:100%",
  }));
}, true);

/* sidebar */
const SIDEBAR_WIDGETS = {
  add: "./widgets/add.js",
  more: "./widgets/more.js",
  settings: "./widgets/settings.js",
  tree: "./widgets/tree.js",
};

const loadWidget = (widget, params, cb) => {
  const widgetEl = findEl(el, '[widget="' + widget + '"]');
  if (!widgetEl) return;
  if (widgetEl.localName === "qcms-widget") return widgetEl.reload();
  // sidebar items are placed by view/panel.ts, so the client ones are named here
  const src = SIDEBAR_WIDGETS[widget];
  if (src) {
    const context = { node: { id: activeId() }, dialogs: root };
    const mounted = widgetEl.firstElementChild;
    if (mounted?.reload) return mounted.reload(context); // the active node may have changed
    return widgetEl.replaceChildren(mountWidget(src, context));
  }
  import("@qino/pub/c1/loading.mjs").then(({ default: loading }) => {
    loading.mark(widgetEl);
    params ||= {};
    params.pid ||= activeId();
    api['cms.frontend.4'].widget(widget).post({ params }).then((res) => {
      loading.done(widgetEl);
      setHtml(widgetEl, res);
      cb?.({ target: widgetEl });
    });
  });
};


uiState.addEventListener("changeIn", () => {
  setSetting(uiState.get({ silent: true }), ["cms.frontend.4", "ui"]); // why silent? should we debounce?
});

function syncSidebar(value = sidebar.value) {
  findAll(el, "> .-sidebar > .-item").forEach((el) => el.classList.remove("-open"));

  if (value) {
    const item = findEl(el, '> .-sidebar > .-item[itemid="' + value + '"]');
    if (!item) return;
    item.classList.add("-open");
    item.focus();

    el.classList.add("-open");
    loadWidget(value);
  } else {
    el.classList.remove("-open");
  }
}
sidebar.addEventListener("set", e => syncSidebar(e.value)); // load only on change; initial state comes from SSR
if (SIDEBAR_WIDGETS[sidebar.value]) loadWidget(sidebar.value); // …except a client widget, which has no SSR

el.addEventListener("click", (e) => {
  const titelEl = e.target.closest(".-sidebar > .-item > .-title");
  if (!titelEl) return;
  cms.cont.active = nodeId;
  sidebar.set(titelEl.closest("[itemid]").getAttribute("itemid"));
});

/* widgets */
widgets.addEventListener("setIn", e => {
  if (e.target.parent !== widgets) return;
  if (e.value) loadWidget(e.target.key);
});
el.addEventListener("click", (e) => {
  if (e.button !== 0) return;
  const wHead = e.target.closest(".-widgetHead");
  if (!wHead) return;
  e.preventDefault();
  const value = wHead.classList.toggle("-open");
  const name = wHead.nextElementSibling.getAttribute("widget");
  if (!name) return;
  widgets.item(name).set(value);
});

on(findEl(el, "> .-sidebar > .-sensor"), "mouseenter touchstart", () => el.classList.add("-sidebar-open"));

on(document, "mousedown touchstart", e => {
  if (e.type === "mousedown" && e.button !== 0) return;
  if (e.composedPath().includes(el)) return;
  el.classList.remove("-sidebar-open");
  sidebar.set("");
});

// shortcuts
onShortcut((key, e) => {
  if (key == "t") {
    cms.cont.active = cms.contPos.active?.pid;
    sidebar.set("tree");
    e.preventDefault();
  }
  if (key == " ") {
    cms.cont.active = cms.contPos.active?.pid;
    sidebar.set("settings");
    e.preventDefault();
  }
  if (key == "v") sidebar.set(sidebar.value === "add" ? "" : "add");
  if (key == "Escape") sidebar.set("");
  if (key == "n") { // n
    sidebar.set("tree");
    setTimeout(() => {
      const inp = findEl(el, "#page-add");
      inp?.focus();
    }, 700);
  }
});

cms.cont.on("upload", (ev) => {
  cms.cont(ev.pid).showWidget("media");
  // the widget's own upload button doubles as the progress bar
  ev.on("progress", (e) => {
    const button = findEl(el, '[widget=media] .-upload');
    if (!button) return;
    const percent = Math.round(e.loaded * 100 / e.total);
    button.textContent = percent + "%";
    button.style.minWidth = "calc(var(--rem) * 9)";
    button.style.backgroundImage = `linear-gradient(to right, var(--cms-color) ${percent}%, transparent ${percent}%)`;
  });
  ev.on("complete", () => {
    cms.console.show(t`File uploaded`);
    loadWidget("media"); // the file did not come through the widget, so it has to re-read
  });
});

api.on("POST cms/node/:id/files", ({ params: { id } }) => {
  cms.cont(id).showWidget("media");
  loadWidget("media");
});
cms.cont.prototype.showWidget = function (what) {
  cms.cont.active = this.id;
  widgets.item(what).set(1);
  sidebar.set("settings");
  cms.Tree?.goTo(this.id);
};

// nothing on the page takes content: no point offering modules
if (!document.querySelector("[qcms-edit][qcms-drop]")) findEl(el, "> .-sidebar > [itemid=add]").hidden = true;

for (const switc of root.querySelectorAll(".qgCMS_editmode_switch")) {
  on(switc, "mouseenter touchstart", () => el.classList.add("-open", "-sidebar-open"));
}

/* update accordion-heads */
for (const [route, head] of [
  ["PUT cms/node/:id/access", "access.grp"],
  ["PUT cms/node/:id/access/groups/*", "access.grp"],
  ["PUT cms/node/:id/access/users/*", "access.usr"],
  ["DELETE cms/node/:id/files/*", "media"],
  ["DELETE cms/node/:id/files/doubles", "media"],
  ["DELETE cms/node/:id/files/all", "media"],
  ["POST cms/node/:id/redirects", "urls"],
  ["DELETE cms/node/:id/redirects", "urls"],
]) api.on(route, () => loadWidget(head));
api.on("PATCH cms/node/:id", ({ input }) => { ("onlineStart" in input || "onlineEnd" in input) && loadWidget("access.time"); });

if (!await ctx.settings["cms.frontend.4"].tour_seen) {
  import("./intro.js").then(({ start }) => start());
}
