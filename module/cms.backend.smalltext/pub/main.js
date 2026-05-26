import { apt } from "../../core/pub/js/apt.js";

cms.initCont("cms.backend.smalltext", (el) => {
  const nid = cms.el.pid(el);
  const node = apt.cms.node(nid);
  const post = (vars) => node.html.post({ vars }).then((html) => { el.outerHTML = html; });

  let search = el.querySelector("[data-search]")?.value ?? "";
  let order = "missing", dir = "desc", debTimer;

  const reloadTable = () =>
    node.html.part("table").post({ vars: { search, order, dir } })
      .then((html) => { el.querySelector("[cms-part=table]").innerHTML = html; });

  el.querySelector("[data-search]")?.addEventListener("input", (e) => {
    search = e.target.value;
    clearTimeout(debTimer);
    debTimer = setTimeout(reloadTable, 400);
  });

  el.addEventListener("click", (e) => {
    const th = e.target.closest("[data-sort]");
    if (th) { order = th.dataset.sort; dir = th.dataset.dir; reloadTable(); return; }

    const action = e.target.closest("[data-action]");
    if (!action) return;
    e.preventDefault();
    const { hash, ns } = action.closest("tr")?.dataset ?? {};
    const vars = hash ? { [action.dataset.action]: { hash, ns } } : { [action.dataset.action]: 1 };
    action.disabled = true;
    node.api.post(vars).then(reloadTable).finally(() => { action.disabled = false; });
  });

  el.addEventListener("change", (e) => {
    const set = e.target.closest("[data-set]");
    if (set) { post({ [set.dataset.set]: set.type === "checkbox" ? +set.checked : set.value }); return; }
    const input = e.target.closest("[data-lang]");
    if (input) { const { hash, ns } = input.closest("tr")?.dataset ?? {}; node.api.post({ save_lang: { hash, ns, lang: input.dataset.lang, value: input.value } }); }
  });
});
