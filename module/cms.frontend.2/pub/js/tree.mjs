/* CMS-Seitenbaum auf Basis von u2-tree.
 * Einstieg: window.cmsTreeInit(json); cms.Tree ist die Fassade für Panel, contextMenu.mjs
 * und Server-Listener. */
import { t, apt } from "../../../core/pub/js/qino.js";

const U2 = "https://cdn.jsdelivr.net/gh/u2ui/u2@1.3.13/";

const showContents = () => cms.panel.state.has("tree_show_c")?.get({ silent: true });
const asTree = (el) => el?.localName === "u2-tree" ? el : null; // Knoten oder null (Icon/Anchor überspringen)

window.cmsTreeInit = async (json) => {
  await import(U2 + "el/tree/tree.js");

  const root = cms.panelRoot;
  if (!root.querySelector("link[data-u2tree]")) {
    const u2css = Object.assign(document.createElement("link"), { rel: "stylesheet", href: U2 + "el/tree/tree.css" });
    u2css.dataset.u2tree = "";
    root.append(u2css); // u2-Basis-CSS; CMS-Optik kommt aus tree.css (panelStyles)
  }

  const treeEl = root.getElementById("tree");
  treeEl.replaceChildren();

  let activeNode = null;

  // Versteckte Wurzel: gemeinsamer active/selection-Scope und Träger aller Listener (Delegation).
  // replaceChildren beim Re-Init wirft sie samt Listenern weg -> kein Stacking.
  const rootNode = document.createElement("u2-tree");
  rootNode.classList.add("-root");
  rootNode.setAttribute("aria-expanded", "true");

  // CMS-JSON -> <u2-tree>; CMS-Felder in node.data, `type` -> `ptype`.
  function makeNode(n) {
    const el = document.createElement("u2-tree");
    el.data = { ...n, key: String(n.key), ptype: n.type };
    el.dataset.key = String(n.key);
    if (n.myaccess >= 2) el.draggable = true;
    renderNode(el);
    if (n.children?.length) {
      for (const c of n.children) el.append(makeNode(c));
      el.setAttribute("aria-expanded", "true");
    } else if (n.isLazy) {
      el.setAttribute("aria-live", "off"); // Lazy-Marker -> Pfeil bleibt
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
    // draggable=false: Links sind nativ ziehbar und würden sonst die Tree-DnD kapern.
    let a = el.querySelector(":scope > .-title");
    if (!a) { a = document.createElement("a"); a.draggable = false; el.append(a); }
    a.className = "-title" + typeMod;
    a.href = d.url || "#";
    let html = `<span cmstxt="${d.title_id}">${d.title}</span>`;
    if (d.ptype === "c") html += ` <span class=-col1 title="${d.module}"> ${String(d.module).replace(/^cms\.cont\./, "")} </span> `;
    html += ` <span class=-col2> ${d.name || ""} </span> `;
    if (!d.public) html += "<span class=-private title=private></span>";
    if (!d.online) html += "<span class=-offline title=offline></span>";
    a.innerHTML = html;
  }

  function activate(node) {
    if (!node || node === rootNode) return;
    if (activeNode !== node) {
      activeNode = node;
      node.select(); // setzt aria-selected (CSS hängt daran), räumt alte Auswahl selbst auf
      try { node.setFocus(); } catch {}
    }
    cms.Tree?.onActivate?.(node);
    const inp = root.getElementById("page-add"), off = node.data.myaccess < 2 || node.data.ptype === "c";
    if (inp) { inp.disabled = off; inp.style.opacity = off ? 0.2 : 1; }
    const el = document.querySelector(".-pid" + node.dataset.key);
    el && cms.contPos(el).mark();
  }

  // Events per Delegation auf rootNode; nodeOf liefert den Knoten zum Event (ohne Wurzel).
  const nodeOf = (e) => { const n = asTree(e.target.closest?.("u2-tree")); return n === rootNode ? null : n; };
  rootNode.addEventListener("u2-tree-select", (e) => activate(e.target)); // Space/Enter + Zeilen-Klick
  rootNode.addEventListener("click", (e) => {
    const node = nodeOf(e);
    if (!node) return;
    if (e.shiftKey) { e.preventDefault(); editNode(node); return; } // Shift+Klick = umbenennen
    if (e.target.closest(".-title")) {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) open(node.data.url, "_blank");
      else if (node.data.url) location.href = node.data.url;
    }
    activate(node);
  });

  const hover = (e) => { // Baumzeile -> Inhaltsblock auf der Seite markieren
    const node = nodeOf(e);
    if (!node) return;
    const el = document.querySelector(".-pid" + node.dataset.key);
    if (!el) return;
    if (e.type === "mouseover") cms.contPos.active?.el !== el && cms.contPos(el).mark();
    else cms.contPos(el).unmark();
  };
  for (const ev of ["mouseover", "mouseout"]) rootNode.addEventListener(ev, hover);

  rootNode.addEventListener("keydown", (e) => {
    if (e.target.closest("input, textarea, select, [contenteditable]")) return;
    const node = nodeOf(e);
    if (!node) return;
    if (e.key === "Enter") node.data.url && (location.href = node.data.url);
    else if (e.key === "Delete" && !e.ctrlKey) {
      if (node.data.myaccess < 3) return;
      if (!confirm(t`Really delete page "${node.data.title}"?`)) return;
      apt.cms.node(node.dataset.key).delete();
    } else if (e.key === "F2") editNode(node);
    else return;
    e.preventDefault();
  });

  // Lazy-Load (nur bei aria-live-Knoten liefert u2 e.load).
  rootNode.addEventListener("u2-tree-expand", (e) => {
    e.load?.((n) =>
      apt.cms.node(n.dataset.key).tree.get({ level: 1, filter: showContents() ? "*" : "p" })
        .then((children) => { for (const c of children) n.append(makeNode(c)); }));
  });

  rootNode.addEventListener("u2-tree-dragover", (e) => { // erlauben, sonst preventDefault (Access-Regeln)
    const target = e.target, { source, parent, region } = e.detail;
    const ok = (target.data?.ptype === "c" && source.data?.ptype === "p") ? false
      : region === "into" ? target.data?.myaccess > 1
      : parent?.data?.myaccess > 1; // before/after: Zugriff auf den Ziel-Elternknoten
    if (!ok) e.preventDefault();
  });
  rootNode.addEventListener("u2-tree-drop", (e) => { // Server-first: erst PUT, Move nach Erfolg
    e.preventDefault();
    const target = e.target, { source, parent, next, region } = e.detail;
    const parentKey = region === "into" ? target.dataset.key : parent.dataset.key;
    apt.cms.node(parentKey)["insert-before"]
      .put({ id: source.dataset.key, before: next?.dataset.key })
      .then(() => {
        parent.insertBefore(source, next);
        region === "into" && target.toggleExpand?.(true);
      });
  });

  function editNode(node) { // u2-tree hat kein Inline-Edit
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
      apt.cms.txt(node.data.title_id).put({ value: title }).then(() => { node.data.title = title; renderNode(node); });
    };
    input.addEventListener("keydown", (ev) => {
      ev.stopPropagation(); // nicht an den Tree-keydown-Handler
      if (ev.key === "Enter") input.blur();
      else if (ev.key === "Escape") { input.value = node.data.title; finish(false); node.setFocus(); }
    });
    input.addEventListener("blur", () => finish(true));
  }

  // Lazy-Äste neu laden (Wurzel ohne key -> Vollreload via goTo).
  function reloadChildren(node, cb) {
    if (!node.dataset.key) return goTo(activeNode?.dataset.key ?? (cms.cont.active || Page)).then(() => cb?.());
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
    apt.cms.node(parent.dataset.key).children.post({ title: name }).then((child) => {
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
    return apt.cms.tree.get({ in: pid, filter: showContents() ? "*" : "p" }).then((json) => {
      rootNode.replaceChildren();
      for (const n of json) rootNode.append(makeNode(n));
      activate(cms.Tree.getNodeByKey(pid));
    });
  }

  cms.Tree = {
    onActivate: null, // wird von panel.mjs gesetzt
    get activeNode() { return activeNode; },
    getNodeByKey: (k) => treeEl.querySelector(`u2-tree[data-key="${k}"]`),
    activate, // ignoriert null/Wurzel selbst
    parent: (n) => asTree(n.parentNode),
    neighbor: (n) => n.prev() || n.next() || asTree(n.parentNode), // u2 prev/next sind slot-bewusst
    update: renderNode,
    reloadChildren,
    editNode,
    addPage,
    goTo,
  };
  for (const n of json) rootNode.append(makeNode(n));
  treeEl.append(rootNode);
  activate(cms.Tree.getNodeByKey(String(cms.cont.active || Page)));
};

/* Live-Updates über die cms.Tree-Fassade */
const onNode = (route, fn) => apt.on(route, (ctx) => { const n = cms.Tree?.getNodeByKey(ctx.params.id); n && fn(n, ctx); });
onNode("PUT cms/node/:id/online-start|PUT cms/node/:id/online-end|PUT cms/node/:id/access", (node) => {
  apt.cms.node(node.dataset.key).get().then((data) => {
    const { key, title, isLazy, type, ...rest } = data;
    Object.assign(node.data, rest, { ptype: type, key: String(key), title });
    cms.Tree.update(node);
    if (isLazy) cms.Tree.reloadChildren(node, () => cms.Tree.activate(node));
  });
});
onNode("PUT cms/node/:id/visible", (node, { input }) => { node.data.visible = input?.value; cms.Tree.update(node); });
onNode("DELETE cms/node/:id", (node) => {
  if (cms.Tree.activeNode === node) cms.Tree.activate(cms.Tree.neighbor(node));
  node.remove();
});
apt.on("PUT cms/node/:id/insert-before", ({ params: { id }, input }) => {
  // gezielt umhängen statt goTo: reflektiert eigene + fremde Moves
  const node = cms.Tree?.getNodeByKey(input?.id);
  const parent = cms.Tree?.getNodeByKey(id);
  if (!node || !parent) return;
  parent.insertBefore(node, input?.before ? cms.Tree.getNodeByKey(input.before) : null);
});
