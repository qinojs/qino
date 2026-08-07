import { api } from "../../core/pub/js/qino.js";

cms.initNode("backend.superuser.db.processes", (el) => {
  const nid = Number(cms.el.nid(el));
  const node = api.cms.node(nid);
  const listEl = el.querySelector("[cms-part=list]"); // the <u2-table>
  const live = el.querySelector("[data-live]");
  const keep = el.querySelector("[data-keep]");
  const ms = Number(listEl?.dataset.refresh) || 1000;
  let timer, busy;

  const bodyOf = (root) => root.querySelector("tbody");
  const parse = (htmlStr) => new DOMParser().parseFromString(`<table>${htmlStr}`, "text/html");

  // Merge the fresh snapshot into the live table so killed/finished processes can stick around.
  const merge = (htmlStr) => {
    const fresh = parse(htmlStr);
    const oldBody = bodyOf(listEl), newBody = bodyOf(fresh);
    if (!oldBody || !newBody) { listEl.innerHTML = htmlStr; return; }

    if (!keep.checked) { oldBody.replaceWith(newBody); }
    else {
      // key by statement (data-key), not connection id — pooled connections reuse ids
      const seen = new Map([...oldBody.children].map((tr) => [tr.dataset.key, tr]));
      for (const tr of [...newBody.children]) {
        const prev = seen.get(tr.dataset.key);
        if (prev) { prev.replaceWith(tr); seen.delete(tr.dataset.key); } // still running → refresh in place
        else oldBody.append(tr); // new statement
      }
      // gone from the snapshot: freeze real queries as a log; drop idle/sleep noise
      for (const tr of seen.values()) {
        if (tr.dataset.gone || tr.querySelector(".-info")?.textContent.trim()) {
          tr.dataset.gone = "1";
          tr.querySelector("[data-kill]")?.setAttribute("disabled", "");
        } else tr.remove();
      }
    }
    // keep the footer (count) in sync
    listEl.querySelector("tfoot")?.replaceWith(fresh.querySelector("tfoot"));
  };

  const refresh = async () => {
    if (busy || document.hidden) return; // skip overlapping / hidden-tab ticks
    busy = true;
    try { merge(await node.html.part("list").get()); }
    finally { busy = false; }
  };

  const start = () => { stop(); timer = setInterval(refresh, ms); };
  const stop = () => { clearInterval(timer); timer = 0; };

  live?.addEventListener("change", () => live.checked ? start() : stop());
  if (live?.checked) start();

  // kill: sleeping connections have no running query → drop the whole connection (hard)
  el.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-kill]");
    if (!btn) return;
    const hard = btn.closest("tr")?.dataset.command === "Sleep" ? 1 : 0;
    btn.disabled = true;
    await node.api.post({ kill: btn.dataset.kill, hard });
    refresh();
  });
});
