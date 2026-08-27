/* CMS page tree based on u2-tree.
  * Entry: window.cmsTreeInit(json); cms.Tree is the facade for panel, contextMenu.js
  * and server listeners. */
import { t, api } from "@qino/pub/qino.js";

import "./contextMenu.js";

const nodeId = globalThis.qino?.cms?.nodeId;
const showContents = () => cms.panel.state.has("tree_show_c")?.get({ silent: true });
const asTree = (el) => el?.localName === "u2-tree" ? el : null; // tree node or null (skip icon/anchor)
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

globalThis.cmsTreeInit = async (json) => {
  await import("@qino/u2/el/tree/tree.js");

  const root = cms.panelRoot;
  if (!root.querySelector("link[data-u2tree]")) {
    const u2css = Object.assign(document.createElement("link"), { rel: "stylesheet", href: import.meta.resolve("@qino/u2/el/tree/tree.css") });
    u2css.dataset.u2tree = "";
    root.append(u2css); // u2 base CSS; the CMS look comes from tree.css (panelStyles)
  }

  const treeEl = root.getElementById("tree");
  treeEl.replaceChildren();

  let activeNode = null;

  // Hidden root: shared active/selection scope and carrier of all listeners (delegation).
  // replaceChildren on re-init throws it away together with its listeners -> no stacking.
  const rootNode = document.createElement("u2-tree");
  rootNode.classList.add("-root");
  rootNode.setAttribute("aria-expanded", "true");

  // CMS JSON -> <u2-tree>; CMS fields in node.data, `type` -> `ptype`.
  function makeNode(n) {
    const el = document.createElement("u2-tree");
    el.data = { ...n, id: String(n.id), ptype: n.type };
    el.dataset.id = String(n.id);
    if (n.myaccess >= 2) el.draggable = true;
    renderNode(el);
    if (n.children?.length) {
      for (const c of n.children) el.append(makeNode(c));
      el.setAttribute("aria-expanded", "true");
    } else if (n.numChildren) {
      el.setAttribute("aria-live", "off"); // lazy marker -> keeps the arrow
      el.setAttribute("aria-expanded", "false");
    }
    return el;
  }

  function renderNode(el) {
    const d = el.data;
    const typeMod = d.ptype && d.ptype !== "p" ? " -type-" + d.ptype : "";
    let icon = el.querySelector(":scope > [slot=icon]");
    if (!icon) { icon = Object.assign(document.createElement("span"), { slot: "icon" }); el.prepend(icon); }
    icon.className = "-access-" + d.myaccess + typeMod + (!d.visible ? " -invisible" : ""); // Styling: tree.css
    // draggable=false: links are natively draggable and would otherwise hijack the tree DnD.
    let a = el.querySelector(":scope > .-title");
    if (!a) { a = document.createElement("a"); a.draggable = false; el.append(a); }
    a.className = "-title" + typeMod;
    a.href = d.url || "#";
    let html = `<span cmstxt="${d.title_id}">${d.title}</span>`;
    if (d.ptype === "c") html += ` <span class=-col1 title="${esc(d.module)}"> ${esc(String(d.module).replace(/^cms\.cont\./, ""))} </span> `;
    html += ` <span class=-col2> ${esc(d.name)} </span> `;
    if (!d.public) html += "<span class=-private title=private></span>";
    if (!d.online) html += "<span class=-offline title=offline></span>";
    a.innerHTML = html;
  }

  function activate(node) {
    if (!node || node === rootNode) return;
    if (activeNode !== node) {
      activeNode = node;
      node.select(); // sets aria-selected (CSS depends on it), clears the old selection itself
      try { node.setFocus(); } catch { /* ignore */ }
    }
    cms.Tree?.onActivate?.(node);
    const inp = root.getElementById("page-add"), off = node.data.myaccess < 2 || node.data.ptype === "c";
    if (inp) { inp.disabled = off; inp.style.opacity = off ? 0.2 : 1; }
    const el = document.querySelector('[qcms-id="' + node.dataset.id + '"]');
    el && cms.contPos(el).mark();
  }

  // Events via delegation on rootNode; nodeOf resolves the event's node (excluding the root).
  const nodeOf = (e) => { const n = asTree(e.target.closest?.("u2-tree")); return n === rootNode ? null : n; };
  rootNode.addEventListener("u2-tree-select", (e) => activate(e.target)); // Space/Enter + row click
  rootNode.addEventListener("click", (e) => {
    const node = nodeOf(e);
    if (!node) return;
    if (e.shiftKey) { e.preventDefault(); editNode(node); return; } // Shift+click = rename
    if (e.target.closest(".-title")) {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) open(node.data.url, "_blank");
      else if (node.data.url) location.href = node.data.url;
    }
    activate(node);
  });

  const hover = (e) => { // tree row -> highlight the content block on the page
    const node = nodeOf(e);
    if (!node) return;
    const el = document.querySelector('[qcms-id="' + node.dataset.id + '"]');
    if (!el) return;
    if (e.type === "mouseover") cms.contPos.active?.el !== el && cms.contPos(el).mark();
    else cms.contPos(el).unmark();
  };
  for (const ev of ["mouseover", "mouseout"]) rootNode.addEventListener(ev, hover);

  rootNode.addEventListener("keydown", async (e) => {
    if (e.target.closest("input, textarea, select, [contenteditable]")) return;
    const node = nodeOf(e);
    if (!node) return;
    if (e.key === "Enter") node.data.url && (location.href = node.data.url);
    else if (e.key === "Delete" && !e.ctrlKey) {
      if (node.data.myaccess < 3) return;
      if (!await cms.dialogs.confirm(t`Really delete page "${node.data.title}"?`)) return;
      api.cms.node(node.dataset.id).delete();
    } else if (e.key === "F2") editNode(node);
    else return;
    e.preventDefault();
  });

  // Lazy load (u2 provides e.load only on aria-live nodes).
  rootNode.addEventListener("u2-tree-expand", (e) => {
    e.load?.((n) =>
      api.cms.node(n.dataset.id).tree.get({ level: 1, filter: showContents() ? "*" : "p" })
        .then((children) => { for (const c of children) n.append(makeNode(c)); }));
  });

  rootNode.addEventListener("u2-tree-dragover", (e) => { // allow, otherwise preventDefault (access rules)
    const target = e.target, { source, parent, region } = e.detail;
    const ok = (target.data?.ptype === "c" && source.data?.ptype === "p") ? false
      : region === "into" ? target.data?.myaccess > 1
        : parent?.data?.myaccess > 1; // before/after: access on the target parent node
    if (!ok) e.preventDefault();
  });
  rootNode.addEventListener("u2-tree-drop", (e) => { // server-first: PUT first, the route listener moves the node
    e.preventDefault();
    const target = e.target, { source, parent, next, region } = e.detail;
    const parentId = region === "into" ? target.dataset.id : parent.dataset.id;
    api.cms.node(parentId)["insert-before"]
      .put({ id: source.dataset.id, before: next?.dataset.id })
      .then(() => region === "into" && target.toggleExpand?.(true));
  });

  function editNode(node) { // u2-tree has no inline edit
    const titleSpan = node.querySelector(":scope > .-title > span[cmstxt]");
    if (!titleSpan) return;
    const input = Object.assign(document.createElement("input"), { value: node.data.title });
    input.style.width = "200px";
    titleSpan.replaceChildren(input);
    input.focus(); input.select();
    let done = false;
    const finish = (save) => {
      if (done) return; done = true;
      const title = save ? input.value : node.data.title;
      api.cms.txt(node.data.title_id).put({ value: title }).then(() => { node.data.title = title; renderNode(node); });
    };
    input.addEventListener("keydown", (ev) => {
      ev.stopPropagation(); // keep it from the tree keydown handler
      if (ev.key === "Enter") input.blur();
      else if (ev.key === "Escape") { input.value = node.data.title; finish(false); node.setFocus(); }
    });
    input.addEventListener("blur", () => finish(true));
  }

  // Reload lazy branches (root without id -> full reload via goTo).
  function reloadChildren(node, cb) {
    if (!node.dataset.id) return goTo(activeNode?.dataset.id ?? (cms.cont.active || nodeId)).then(() => cb?.());
    for (const c of [...node.querySelectorAll(":scope > u2-tree")]) c.remove();
    node.setAttribute("aria-live", "off");
    node.removeAttribute("aria-busy");
    node.setAttribute("aria-expanded", "false");
    node.toggleExpand(true);
    return Promise.resolve().then(() => cb?.());
  }

  function addPage(name) {
    const parent = activeNode;
    if (!parent) return;
    api.cms.node(parent.dataset.id).children.post({ title: name }).then((child) => {
      if (!child) return;
      const node = makeNode(child);
      parent.insertBefore(node, parent.querySelector(":scope > u2-tree"));
      parent.toggleExpand(true);
      const a = node.querySelector(":scope > .-title");
      a?.classList.add("-new");
      setTimeout(() => a?.classList.remove("-new"), 2000);
    });
  }

  function goTo(pid) {
    pid = String(pid);
    return api.cms.tree.get({ filter: showContents() ? "*" : "p", expandTo: pid }).then((json) => {
      rootNode.replaceChildren();
      for (const n of json) rootNode.append(makeNode(n));
      activate(cms.Tree.getNodeById(pid));
    });
  }

  cms.Tree = {
    onActivate: null, // set by the tree widget
    get activeNode() { return activeNode; },
    getNodeById: (id) => treeEl.querySelector(`u2-tree[data-id="${id}"]`),
    activate, // ignores null/root itself
    parent: (n) => asTree(n.parentNode),
    neighbor: (n) => n.prev() || n.next() || asTree(n.parentNode), // u2 prev/next are slot-aware
    update: renderNode,
    reloadChildren,
    editNode,
    addPage,
    goTo,
  };
  for (const n of json) rootNode.append(makeNode(n));
  treeEl.append(rootNode);
  activate(cms.Tree.getNodeById(String(cms.cont.active || nodeId)));
};

/* Live updates via the cms.Tree facade */
const onNode = (route, fn) => api.on(route, (ctx) => { const n = cms.Tree?.getNodeById(ctx.params.id); n && fn(n, ctx); });
const applyNode = (node, data) => {
  const { id, title, numChildren, type, ...rest } = data;
  Object.assign(node.data, rest, { ptype: type, id: String(id), title });
  cms.Tree.update(node);
  return numChildren;
};
onNode("PUT cms/node/:id/access", (node) => {
  api.cms.node(node.dataset.id).get().then((data) => {
    if (applyNode(node, data)) cms.Tree.reloadChildren(node, () => cms.Tree.activate(node));
  });
});
// PATCH answers with the node itself — no refetch; only inherited online state affects the subtree
onNode("PATCH cms/node/:id", (node, { value, input }) => {
  const numChildren = applyNode(node, value);
  if (numChildren && ("onlineStart" in input || "onlineEnd" in input)) cms.Tree.reloadChildren(node, () => cms.Tree.activate(node));
});
onNode("DELETE cms/node/:id", (node) => {
  if (cms.Tree.activeNode === node) cms.Tree.activate(cms.Tree.neighbor(node));
  node.remove();
});
api.on("PUT cms/node/:id/insert-before", ({ params: { id }, input }) => {
  // re-attach precisely instead of goTo: reflects own + foreign moves
  const node = cms.Tree?.getNodeById(input?.id);
  const parent = cms.Tree?.getNodeById(id);
  if (!node || !parent) return;
  parent.insertBefore(node, input?.before ? cms.Tree.getNodeById(input.before) : null);
});
