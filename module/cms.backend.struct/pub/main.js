cms.initCont("cms.backend.struct", async (el) => {
  const { apt } = await import(el.dataset.sysUrl + "core/pub/js/apt.js");

  function toggle(btn, labels, fn) {
    const on = btn.style.color === "green";
    fn(!on).then(() => { btn.innerHTML = labels[+!on]; btn.style.color = !on ? "green" : "red"; });
    return false;
  }

  globalThis.toggleVisible    = (btn, pid) => toggle(btn, ["hidden", "visible"],              v => apt.cms.node(pid).visible.put({ value: v }));
  globalThis.toggleSearchable = (btn, pid) => toggle(btn, ["not searchable", "searchable"],   v => apt.cms.node(pid).searchable.put({ value: v }));
  globalThis.toggleAccess     = (btn, pid) => toggle(btn, ["private", "public"],              v => apt.cms.node(pid).access.put({ value: +v }));

  el.querySelector(".cmsBeTree")?.addEventListener("click", async (e) => {
    const a = e.target.closest("[data-toggle-node]");
    if (!a) return;
    e.preventDefault();
    const nid = a.dataset.toggleNode, id = a.dataset.toggleId, val = a.dataset.toggleValue;
    const html = await apt.cms.node(nid).html.part("list").get({ vars: { toggleOpen: id, value: val } });
    a.closest("tbody[data-part=list]").innerHTML = html;
  });
});
