import { apt } from "../../core/pub/js/qino.js";

cms.initNode("backend.cms.tree", (el) => {
  const tree = el.querySelector(".cmsBeTree");

  const reloadList = (vars = {}) => cms.reloadPart(cms.el.nid(el), "list", vars);

  tree?.addEventListener("click", async (e) => {
    // expand / collapse a tree node
    const toggleNode = e.target.closest("[data-toggle-node]");
    if (toggleNode) {
      e.preventDefault();
      await reloadList({ toggleOpen: toggleNode.dataset.toggleId, value: toggleNode.dataset.toggleValue });
      return;
    }

    // cycle public access: inherited ("") -> yes (1) -> no (0) -> inherited ...
    const btn = e.target.closest("button[data-toggle=access]");
    if (!btn) return;
    e.preventDefault();
    const cur = btn.dataset.v;
    const next = cur === "" ? 1 : cur === "1" ? 0 : null;
    await apt.cms.node(btn.dataset.pid).access.put(next == null ? {} : { value: next });
    await reloadList(); // re-render: inheritance affects children
  });

  // boolean properties as checkboxes (visible / searchable)
  tree?.addEventListener("change", (e) => {
    const box = e.target.closest("input[type=checkbox][data-toggle]");
    if (!box) return;
    apt.cms.node(box.dataset.pid)[box.dataset.toggle].put({ value: box.checked });
  });

  // show/hide content elements in the tree
  el.querySelector("[data-toggle-contents]")?.addEventListener("change", (e) => {
    reloadList({ showContents: e.target.checked ? "1" : "0" });
  });
});
