import { itemJs } from "@qino/pub/SettingsEditor.mjs";
import { api, t, ctx } from "@qino/pub/qino.js";

import { root } from "../js/root.js";
import { widget as mountWidget } from "./widget.js";
import { onShortcut } from "../js/shortcut.js";
import "./contentMenu.js";

const nodeId = globalThis.qino?.cms?.nodeId;

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
const uiState = item(cmsFrontend2Data ?? {});
const sidebar = uiState.item("sidebar");
const widgets = uiState.item("widget");
if (!widgets.filled) widgets.set({});

cms.panel = { state: uiState, sidebar, widgets };
cms.panelRoot = root;
const el = root.getElementById("panel");
el.showPopover();
const { SelectorObserver } = await import("@qino/u2/js/SelectorObserver/SelectorObserver.js");
const { alert, confirm } = root;

// A failed <img> fires no bubbling event, so the media list is listened to at the root.
root.addEventListener("error", (e) => {
  const src = e.target?.dataset?.audio;
  if (!src) return;
  e.target.replaceWith(Object.assign(document.createElement("audio"), {
    src, controls: true, draggable: true, style: "min-width:calc(var(--rem) * 4.4); width:100%",
  }));
}, true);

// widget controllers get the node their markup carries
function onEl(selector, fn) {
  new SelectorObserver({ on: el => requestAnimationFrame(() => {
    const pid = el.getAttribute("pid");
    fn(el, pid, pid && api.cms.node(pid));
  }) }).observe(selector, { root });
}

/* sidebar */
const SIDEBAR_WIDGETS = { add: "./widgets/add.js" };

const loadWidget = (widget, params, cb) => {
  const widgetEl = findEl(el, '[widget="' + widget + '"]');
  if (!widgetEl) return;
  if (widgetEl.localName === "qcms-widget") return widgetEl.reload();
  // sidebar items are placed by view/panel.ts, so the client ones are named here
  const src = SIDEBAR_WIDGETS[widget];
  if (src) {
    const mounted = widgetEl.firstElementChild;
    if (mounted?.reload) return mounted.reload();
    return widgetEl.replaceChildren(mountWidget(src, { node: { id: cms.cont.active || nodeId }, dialogs: root }));
  }
  import("@qino/pub/c1/loading.mjs").then(({ default: loading }) => {
    loading.mark(widgetEl);
    params ||= {};
    params.pid ||= cms.cont.active || nodeId;
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
    const content = findEl(el, '> .-sidebar > [itemid="' + value + '"] > .-content');
    if (!content) return;
    loadWidget(value, { pid: cms.cont.active || nodeId });
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
  if (e.value) loadWidget(e.target.key, { pid: cms.cont.active || nodeId });
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

api.on("POST cms/node/:id/contents", () => sidebar.set(""));

cms.cont.on("upload", (ev) => {
  cms.cont(ev.pid).showWidget("media");
  ev.on("progress", (e) => {
    const percent = Math.round(e.loaded * 100 / e.total);
    const button = findEl(el, '[cmsconf="contMedia_overview"] button');
    if (button) {
      button.innerHTML = percent + "%";
      button.style.minWidth = "150px";
      button.style.backgroundImage =
        "linear-gradient(to right, var(--cms-color); 0%, var(--cms-color); " +
        percent + "%, transparent " + percent + "%, transparent)";
    }
  });
  ev.on("complete", () => {
    cms.console.show(t`File uploaded`);
    cms.cont(ev.pid).showWidget("media", true);
  });
});

api.on("POST cms/node/:id/files", ({ params: { id } }) => {
  cms.cont(id).showWidget("media", true);
});
cms.cont.prototype.showWidget = function (what, reload) {
  if (!reload) {
    if (
      cms.cont.active == this.id && what === widgets.has(what)?.get({ silent: true })
    ) return;
  }
  cms.cont.active = this.id;
  widgets.item(what).set(1);
  sidebar.set("settings");
  cms.Tree?.goTo(this.id);
};

!document.querySelector("[qcms-edit][qcms-drop]") &&
  findEl(el, "> .-sidebar > [itemid=add]").setAttribute("hidden", "hidden");

const switches = root.querySelectorAll(".qgCMS_editmode_switch");
function enter() {
  el.classList.add("-open", "-sidebar-open");
}
for (const switc of switches) {
  on(switc, "mouseenter touchstart", enter);
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

onEl(".tree-manager", async (el) => {
  await import("./tree.js");
  // add Page
  const inp = root.getElementById("page-add");
  function add() {
    const v = inp.value.trim();
    v && cms.Tree.addPage(v);
    inp.value = "";
  }
  inp.addEventListener("blur", async (e) => {
    if (e.currentTarget.value && await confirm(t`Create page "${e.currentTarget.value}"?`)) add();
  });
  inp.addEventListener("keydown", (e) => {
    e.key === "Enter" && add();
    if (e.key === "Escape") {
      e.currentTarget.value = "";
      e.currentTarget.blur();
    }
  });
  const tree = JSON.parse(el.getAttribute("data"));
  await cmsTreeInit(tree);
  // change placeholder
  cms.Tree.onActivate = (node) => {
    inp.placeholder = inp.placeholder.replace(/"([^"]*)"/, `"${node.data.title}"`);
  };
});

onEl(".more-manager", (el) => {
  findEl(el, ".-tour").onclick = () => import("./intro.js").then(({ start }) => start());
  // feedback-formular
  findEl(el, ".-feedbackform").addEventListener("submit", (e) => {
    e.preventDefault();
    loadWidget("more", {
      pid: nodeId,
      msg: findEl(e.currentTarget, "[name=msg]").value,
      link: location.href,
    });
  });
  findEl(el, ".-feedbackform [name=msg]").addEventListener(
    "input",
    c1.debounce((e) => {
      setSetting(e.target.value, ["cms", "feedback", "text"]);
    }, 200),
  );
  // change password
  findEl(el, ".-pwchange").addEventListener("submit", async (e) => {
    e.preventDefault();
    const oldpw = findEl(e.currentTarget, "[name=old]").value;
    const pw = findEl(e.currentTarget, "[name=new]").value;
    const pw2 = findEl(e.currentTarget, "[name=new2]").value;
    if (pw2 !== pw) await alert(t`Passwords do not match`);
    else {
      try {
        await api.core.password.put({ oldpw, pw });
        await alert(t`Password changed successfully.`);
      } catch (err) { await alert(err.message); }
    }
  });
  findEl(el, ".-changelang").addEventListener("change", (e) => {
    const val = e.currentTarget.options[e.currentTarget.selectedIndex].value;
    const path = JSON.parse(e.currentTarget.name);
    setSetting(val, path).then(() => {
      location.href = location.href.replace(/#.*$/, "");
    });
  });
  findEl(el, ".-tree-show-c").addEventListener("change", (e) => {
    setSetting(e.currentTarget.checked, ["cms.frontend.4", "ui", "tree_show_c"])
      .then(() => {
        location.href = location.href.replace(/#.*$/, "");
      });
  });

});

// The placeholder makes way for the widgets: an extra dom level would break
// `.-widgetHead:first-child`, which spaces the accordions apart.
onEl(".-widgets", async (el, pid) => {
  const list = await api["cms.frontend.4"].widgets(pid).get();
  const nodes = [];
  for (const { name, src, title, context } of list) {
    const head = c1.dom.el('<div class=-widgetHead><span class=-title></span></div>');
    head.classList.toggle("-open", !!widgets.has(name)?.get({ silent: true }));
    const w = mountWidget(src, { node: { id: pid }, dialogs: root, ...context });
    w.className = "-content";
    w.setAttribute("widget", name); // the accordion click handler and the reload table find it by name
    w.addEventListener("qcms-widget-head", ({ detail }) => {
      findEl(head, ".-title").textContent = detail.head ?? title ?? name;
      for (const old of findAll(head, ".-info")) old.remove();
      const badges = Array.isArray(detail.badge) ? detail.badge : [{ text: detail.badge }];
      for (const b of badges) {
        if (!b?.text && b?.text !== 0) continue;
        const info = c1.dom.el("<span class=-info></span>");
        if (b.class) info.classList.add(b.class);
        info.textContent = b.text;
        head.append(info);
      }
    });
    nodes.push(head, w);
  }
  el.replaceWith(...nodes);
});
onEl(".content-manager", (el, pid, node) => {
  // change module
  findEl(el, ".-changemodule").addEventListener("change", (e) => {
    const val = e.currentTarget.options[e.currentTarget.selectedIndex].value;
    const type = el.getAttribute("page-type");
    node.module.put({ module: val }).then(() => {
      if (type === "p") location.href = location.href.replace(/#.*$/, "");
    });
    if (type !== "p") {
      node.html.get().then(html => { document.querySelector('[qcms-id="'+pid+'"]').outerHTML = html; });
      sidebar.set("settings");
    }
  });
  // parent
  const editparent = findEl(el, ".-editparent");
  editparent?.addEventListener("click", (e) => {
    const pid = e.currentTarget.getAttribute("parent");
    const type = e.currentTarget.getAttribute("page-type");
    if (type !== "p") {
      e.preventDefault();
      cms.cont.active = pid;
      sidebar.set("settings");
    }
  });
});
onEl(".superuser-manager", (el, pid) => {
  el.addEventListener("keyup", (e) => {
    if (e.key !== "Enter") return;
    const create = e.target.closest(".-create");
    if (!create) return;
    const scope = e.target.closest("[scope]").getAttribute("scope");
    loadWidget("superuser", { pid, create: create.value, in: scope });
  });
  el.addEventListener("click", async (e) => {
    const scopeEl = e.target.closest("[scope]");
    if (!scopeEl) return;
    const scope = scopeEl.getAttribute("scope");
    const remove = e.target.closest(".-remove");
    if (remove) {
      const file = remove.parentNode.getAttribute("itemid");
      if (await confirm(t`Really delete this file?`)) loadWidget("superuser", { pid, delete: file, in: scope });
    }
  });
});

if (!await ctx.settings["cms.frontend.4"].tour_seen) {
  import("./intro.js").then(({ start }) => start());
}
