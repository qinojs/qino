cms.initNode("backend.superuser.requests.clients", (el) => {
  const nid = Number(cms.el.nid(el));
  const form = el.querySelector("[data-filter]");
  const reload = () => cms.reloadPart(nid, "list", { filter: Object.fromEntries(new FormData(form)) });
  form?.addEventListener("input", reload);
  form?.addEventListener("submit", (e) => { e.preventDefault(); reload(); });
});
