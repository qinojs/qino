cms.initCont("cms.backend.struct.access", async (el) => {
  const { apt } = await import(el.dataset.sysUrl + "core/pub/js/apt.js");

  const table = el.querySelector(".cmsBeTree");

  async function reloadList(nid, vars = {}) {
    const html = await apt.cms.node(nid).html.part("list").post({ vars });
    el.querySelector("tbody[data-part=list]").innerHTML = html;
  }

  table?.addEventListener("click", async (e) => {
    // expand/collapse a tree node
    const toggle = e.target.closest("[data-toggle-node]");
    if (toggle) {
      e.preventDefault();
      await reloadList(toggle.dataset.toggleNode, { toggleOpen: toggle.dataset.toggleId, value: toggle.dataset.toggleValue });
      return;
    }

    // change access of a cell
    const td = e.target.closest("td.-cell[v]");
    if (!td) return;
    const pid = td.dataset.pid;

    if (td.dataset.gid) {
      // group cell: cycle 0 -> 1 -> 2 -> 3 -> 0
      const access = Number(td.getAttribute("v")) || 0;
      // TODO: path is node/access/groups because cms/apt.ts nests `groups` (and `users`)
      // under `access` instead of as siblings of it. Should be node/groups/:group.
      await apt.cms.node(pid).access.groups(td.dataset.gid).put({ access: access > 2 ? 0 : access + 1 });
    } else {
      // public cell: cycle inherited ("") -> yes (1) -> no (0) -> inherited ...
      const cur = td.getAttribute("v");
      const next = cur === "" ? 1 : cur === "1" ? 0 : null;
      await apt.cms.node(pid).access.put(next == null ? {} : { value: next });
    }

    // reload the tree so inheritance changes propagate
    await reloadList(el.dataset.node);
  });

  // show/hide content elements in the tree
  el.querySelector("[data-toggle-contents]")?.addEventListener("change", (e) => {
    reloadList(el.dataset.node, { showContents: e.target.checked ? "1" : "0" });
  });

  // highlight the page a row inherits its access from
  table?.addEventListener("mouseover", (e) => {
    table.querySelector("tr.-mark")?.classList.remove("-mark");
    const tr = e.target.closest("tr");
    const inherited = tr?.dataset.inherited;
    if (!inherited) return;
    table.querySelector(`tr[data-inherited="${inherited}"]`)?.classList.add("-mark");
  });
});
