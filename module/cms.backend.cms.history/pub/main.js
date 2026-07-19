import { apt } from "../../core/pub/js/qino.js";

cms.initNode("backend.cms.history", (el) => {
  const nid = Number(cms.el.nid(el));
  const form = el.querySelector(".-filter");
  const list = el.querySelector("[cms-part=history]");
  const status = el.querySelector(".-status");

  const filterVars = () => {
    const f = Object.fromEntries(new FormData(form));
    // datetime-local is in the browser's TZ → send UTC unix seconds
    for (const k of ["from", "to"]) if (f[k]) f[k] = String(Math.floor(new Date(f[k]).getTime() / 1000));
    return f;
  };

  // newest node_changed id currently on screen — the watermark for incremental polls
  const newestId = () => {
    let max = 0;
    for (const tr of list.querySelectorAll("tr[data-nc]")) max = Math.max(max, Number(tr.dataset.nc) || 0);
    return max;
  };

  const updateStatus = () => {
    const n = list.querySelectorAll("tr[data-key]").length;
    if (status) status.textContent = n ? n + " events" : "";
  };

  // full reload of the list part (filter changed): replaces the tbody content
  let timer;
  const reload = () => cms.reloadPart(nid, "history", { filter: filterVars() }).then(updateStatus);
  form.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(reload, 300); });
  form.addEventListener("submit", (e) => e.preventDefault());

  // Incremental refresh: fetch only rows newer than the watermark and merge them
  // at the top. Existing rows keep their DOM identity, so a text selection, the
  // scroll position and the live <u2-time> elements all survive the update.
  const refresh = async () => {
    if (document.hidden) return;
    const vars = { filter: { ...filterVars(), sinceId: String(newestId()) } };
    const htmlStr = await apt.cms.node(nid).html.part("history").post({ vars }).catch(() => null);
    if (htmlStr == null) return;
    const tpl = document.createElement("template");
    tpl.innerHTML = htmlStr;
    const rows = [...tpl.content.querySelectorAll("tr[data-key]")];
    if (!rows.length) return;
    list.querySelector("tr.-empty")?.remove();
    // response is newest-first; insert reversed so the newest ends up on top
    for (const row of rows.reverse()) {
      const existing = list.querySelector(`tr[data-key="${CSS.escape(row.dataset.key)}"]`);
      if (existing) existing.replaceWith(row);
      else list.prepend(row);
    }
    updateStatus();
  };

  updateStatus();
  setInterval(refresh, 5000);
});
