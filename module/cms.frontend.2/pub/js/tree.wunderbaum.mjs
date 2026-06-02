/* Copyright (c) 2016 Tobias Buschor https://goo.gl/gl0mbf | MIT License https://goo.gl/HgajeK */
/* CMS-Seitenbaum mit Wunderbaum – vanilla ESM, ohne jQuery.
 * Aktivierung über den Switch in tree.mjs (localStorage.cmsTreeEngine='wunderbaum' bzw. ?tree=wunderbaum).
 * Hält denselben Vertrag wie tree.dynatree.mjs: window.cmsTreeInit(json) + cms.Tree.
 */
import { t, apt } from "../../../core/pub/js/qino.js";

// Auf eine eigene (uncdn-)Spiegelung umbiegbar:
const WB_JS = "https://cdn.jsdelivr.net/npm/wunderbaum@0/dist/wunderbaum.esm.min.js";
const WB_CSS = "https://cdn.jsdelivr.net/npm/wunderbaum@0/dist/wunderbaum.css";

const showContents = () => cms.panel.state.has("tree_show_c")?.get({ silent: true });

// dynatree-JSON -> wunderbaum-source (CMS-Felder landen in node.data; `type` -> `ptype`, da bei wunderbaum reserviert)
const toWb = (n) => {
  const { key, title, isLazy, children, type, ...data } = n;
  return { key: String(key), title, lazy: !!isLazy, ptype: type, ...data, children: children?.map(toWb) };
};

window.cmsTreeInit = async (json) => {
  const { Wunderbaum } = await import(WB_JS);
  const root = cms.panelRoot;

  // CSS in den Shadow-Root des Panels (dort lebt der Baum).
  // wunderbaum-CSS zuerst, dann unser Override (gewinnt bei gleicher Spezifität).
  if (!root.querySelector("link[data-wb]")) {
    const wb = Object.assign(document.createElement("link"), { rel: "stylesheet", href: WB_CSS });
    wb.dataset.wb = "";
    root.append(wb);
    root.append(Object.assign(document.createElement("link"), { rel: "stylesheet", href: sysURL + "cms.frontend.2/pub/css/tree.wunderbaum.css" }));
  }

  const treeEl = root.getElementById("tree");
  treeEl.replaceChildren(); // sauberer, leerer Container (kein Alt-Markup -> kein "columns/header"-Fehler)
  // Wunderbaum scrollt virtuell -> Viewport-Höhe muss begrenzt sein,
  // sonst wächst .wb-list-container endlos (dynatree braucht das nicht).
  treeEl.style.maxHeight = "70vh";
  treeEl.style.overflow = "auto";

  const tree = new Wunderbaum({
    element: treeEl,
    source: json.map(toWb),
    lazyLoad: (e) =>
      apt.cms.node(e.node.key).tree.get({ level: 1, filter: showContents() ? "*" : "p" }).then((res) => res.map(toWb)),
    render: (e) => renderNode(e),
    activate: (e) => onActivate(e.node),
    click: (e) => onClick(e),
    keydown: (e) => onKeydown(e),
    edit: {
      trigger: ["F2", "macEnter"],
      apply: (e) => apt.cms.txt(e.node.data.title_id).put({ value: e.newValue }),
    },
    dnd: {
      effectAllowed: "all",
      dropEffectDefault: "move",
      guessDropEffect: true,
      autoExpandMS: 700, // zugeklappten Knoten beim Drüberziehen öffnen (wie dynatree; wunderbaum-Default ist 1500)
      preventLazyParents: false, // sonst lässt wunderbaum kein "over" auf noch ungeladene Lazy-Knoten zu -> man könnte in zugeklappte Äste nicht reinverschieben
      dragStart: (e) => e.node.data.myaccess >= 2,
      dragEnter: (e) => dropRegions(e.node, e.sourceNode),
      drop: (e) => onDrop(e),
    },
  });

  patchNodeApi(Object.getPrototypeOf(tree.root)); // dynatree-kompatible Aliase für contextMenu.mjs + Listener

  cms.Tree = {
    onActivate: null, // wird von panel.mjs gesetzt (placeholder-update)
    get activeNode() {
      return tree.activeNode ?? tree.getActiveNode?.();
    },
    getNodeByKey: (k) => tree.findKey(String(k)),
    editNode: (node) => node.startEditTitle(),
    addPage,
    goTo,
  };

  function addPage(name) {
    const parent = tree.activeNode ?? tree.getActiveNode?.();
    if (!parent) return;
    apt.cms.node(parent.key).children.post({ title: name }).then((child) => {
      if (!child) return;
      const added = parent.addChildren(toWb(child), { before: parent.children?.[0] });
      const node = Array.isArray(added) ? added[0] : added;
      parent.setExpanded(true);
      const el = node.titleSpan?.closest(".wb-node");
      el?.classList.add("-new");
      setTimeout(() => el?.classList.remove("-new"), 2000);
    });
  }

  function goTo(pid) {
    pid = String(pid);
    apt.cms.tree.get({ in: pid, filter: showContents() ? "*" : "p" }).then((json) => {
      tree.root.removeChildren();
      tree.root.addChildren(json.map(toWb));
      tree.findKey(pid)?.setActive(true);
    });
  }

  // initial aktive Seite
  tree.findKey(String(cms.cont.active || Page))?.setActive(true);
};

function renderNode(e) {
  const node = e.node;
  const d = node.data;
  d.key = node.key; d.title = node.title; d.isLazy = node.lazy; // dynatree-kompat (contextMenu/Listener lesen node.data.*)
  // wunderbaum-Render-Event: das Knoten-Element ist e.nodeElem (span.wb-node)
  const nodeEl = e.nodeElem || e.nodeElement || node.titleSpan?.closest(".wb-node");
  const titleEl = nodeEl?.querySelector(".wb-title") || node.titleSpan || nodeEl;
  if (!nodeEl || !titleEl) return;

  // identisches Markup wie dynatree onCustomRender -> tree.css greift unverändert.
  // Access-Punkt (.dynatree-icon) selbst rendern; wunderbaums Font-Icon fehlt mangels Icon-Font.
  let html = `<span class=dynatree-icon></span><a class="dynatree-title" href="#"><span cmstxt="${d.title_id}">${node.title}</span>`;
  if (d.ptype === "c") {
    html += ` <span class=-col1 title="${d.module}"> ${String(d.module).replace(/^cms\.cont\./, "")} </span> `;
  }
  html += ` <span class=-col2> ${d.name || ""} </span> `;
  if (!d.public) html += "<span class=-private title=private></span>";
  if (!d.online) html += "<span class=-offline title=offline></span>";
  html += "</a>";
  titleEl.innerHTML = html;

  // dynatree-Klassen aufprägen -> tree.css greift + contextMenu (#panel .dynatree-node)
  nodeEl.classList.add("dynatree-node");
  [...nodeEl.classList].forEach((c) => /^-(access|type)-|^-invisible$/.test(c) && nodeEl.classList.remove(c));
  nodeEl.classList.add("-access-" + d.myaccess);
  if (d.ptype && d.ptype !== "p") nodeEl.classList.add("-type-" + d.ptype);
  if (!d.visible) nodeEl.classList.add("-invisible");
  const rowEl = nodeEl.closest(".wb-row");
  if (rowEl) rowEl.title = "ID " + node.key;
}

function onActivate(node) {
  node.data.title = node.title; // dynatree-kompat
  cms.Tree?.onActivate?.(node); // placeholder-update (panel.mjs)
  const inp = cms.panelRoot.getElementById("page-add");
  if (inp) {
    const off = node.data.myaccess < 2 || node.data.ptype === "c";
    inp.disabled = off;
    inp.style.opacity = off ? 0.2 : 1;
  }
  const el = document.querySelector(".-pid" + node.key);
  el && cms.contPos(el).mark();
}

function onClick(e) {
  const { node, event: ev } = e;
  if (!node) return;
  if (ev.shiftKey) {
    node.startEditTitle();
    return false;
  }
  // wie dynatree: nur der Titel-Link navigiert; sonst nur anwählen (wunderbaum aktiviert selbst)
  if (ev.target.closest("a")) {
    ev.preventDefault();
    if (ev.ctrlKey) open(node.data.url, "_blank");
    else location.href = node.data.url;
  }
}

function onKeydown(e) {
  const { node, event: ev } = e;
  if (!node) return;
  if (ev.key === "Enter") location.href = node.data.url;
  if (ev.key === "Delete" && !ev.ctrlKey) {
    if (node.data.myaccess < 3) return;
    if (!confirm(t`Really delete page "${node.title}"?`)) return;
    apt.cms.node(node.key).delete();
  }
  // F2 -> edit-Extension (siehe edit.trigger)
}

function dropRegions(target, source) {
  if (target.data.ptype === "c" && source.data.ptype === "p") return false;
  const regions = [];
  if (target.data.myaccess > 1) regions.push("over");
  if (target.parent?.data.myaccess > 1) regions.push("before", "after");
  return regions.length ? regions : false;
}

function onDrop(e) {
  const { node: target, sourceNode: source, region } = e;
  const parent = region === "over" ? target.key : target.parent.key;
  let before;
  if (region === "after") before = target.getNextSibling()?.key;
  else if (region === "before") before = target.key;
  apt.cms.node(String(parent))["insert-before"]
    .put({ id: source.key, before: before != null ? String(before) : undefined })
    .then(() => source.moveTo(target, e.suggestedDropMode ?? (region === "over" ? "appendChild" : region)));
}

// dynatree-Aliase, die contextMenu.mjs und die Server-Listener auf den Nodes erwarten
function patchNodeApi(proto) {
  if (proto._cmsPatched) return;
  proto._cmsPatched = true;
  proto.activate = function () { return this.setActive(true); };
  proto.render = function () { return this.update(); };
  proto.reloadChildren = function (cb) {
    this.resetLazy();
    return this.setExpanded(true).then(() => cb?.());
  };
}

/* Server-Listener (Live-Updates) – nutzen die cms.Tree-Fassade */
apt.on("PUT cms/node/:id/online-start|PUT cms/node/:id/online-end|PUT cms/node/:id/access", ({ params: { id } }) => {
  const node = cms.Tree?.getNodeByKey(id);
  if (!node) return;
  apt.cms.node(id).get().then((data) => {
    const { key, title, isLazy, type, children, ...rest } = data;
    Object.assign(node.data, rest, { ptype: type, key: String(key), title, isLazy: !!isLazy });
    node.setTitle(title);
    node.update();
    if (isLazy) node.reloadChildren(() => cms.Tree.getNodeByKey(id)?.setActive(true));
  });
});
apt.on("PUT cms/node/:id/visible", ({ params: { id }, input }) => {
  const node = cms.Tree?.getNodeByKey(id);
  if (!node) return;
  node.data.visible = input?.value;
  node.update();
});
apt.on("PUT cms/node/:id/insert-before", ({ input }) => cms.Tree?.goTo(input?.id));
apt.on("DELETE cms/node/:id", ({ params: { id } }) => {
  const node = cms.Tree?.getNodeByKey(id);
  if (!node) return;
  if ((cms.Tree.activeNode) === node) {
    (node.getPrevSibling() || node.getNextSibling() || node.parent)?.setActive(true);
  }
  node.remove();
});
