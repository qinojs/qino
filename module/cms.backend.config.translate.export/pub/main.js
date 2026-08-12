import { api } from "@qino/pub/qino.js";

cms.initNode("backend.config.translate.export", (el) => {
  const node = api.cms.node(cms.el.nid(el));
  const result = el.querySelector("[data-result]");

  el.querySelector("[data-action=export]")?.addEventListener("click", async (e) => {
    e.target.disabled = true;
    result.textContent = "…";
    try {
      const r = await node.api.post({ export: 1 });
      result.textContent = r?.written?.length
        ? `${r.written.length} files written`
        : "nothing exported";
    } catch (e) {
      result.textContent = e.message;
    } finally {
      e.target.disabled = false;
    }
  });

  el.querySelector("[data-action=preview]")?.addEventListener("click", async (e) => {
    e.target.disabled = true;
    result.textContent = "…";
    try {
      const r = await node.api.post({ preview: 1 });
      result.replaceChildren(renderChanges(r?.changes));
    } catch (e) {
      result.textContent = e.message;
    } finally {
      e.target.disabled = false;
    }
  });
});

// Per-file diff view: changed (overwritten), added (new), removed (lost)
function renderChanges(changes) {
  const frag = document.createDocumentFragment();
  if (!changes?.length) { frag.append("No changes — files are up to date."); return frag; }
  for (const c of changes) {
    const det = document.createElement("details");
    det.open = true;
    const sum = document.createElement("summary");
    sum.textContent = `${c.ns}/${c.lang}.json — ~${c.changed.length} +${c.added.length} -${c.removed.length}`;
    det.append(sum);
    const dl = document.createElement("dl");
    for (const ch of c.changed) dl.append(term("~", ch.key), def(`${ch.old} → ${ch.new}`));
    for (const a of c.added) dl.append(term("+", a.key), def(a.new));
    for (const k of c.removed) dl.append(term("-", k));
    det.append(dl);
    frag.append(det);
  }
  return frag;
}

function term(mark, text) {
  const dt = document.createElement("dt");
  dt.textContent = `${mark} ${text}`;
  return dt;
}

function def(text) {
  const dd = document.createElement("dd");
  dd.textContent = text;
  return dd;
}
