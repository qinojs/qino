// Keep the URL fragment when switching language (the server never sees it). Delegated on document,
// since frontend layouts have no cms.mjs.
const root = "[qcms-mod='cont.lang.choose2'] ";

document.addEventListener("click", (e) => {
  const a = e.target.closest?.(root + "a[hreflang]");
  if (!a || !location.hash) return;
  e.preventDefault();
  location.href = a.href + location.hash;
});

document.addEventListener("change", (e) => {
  const select = e.target.closest?.(root + "select");
  if (select) location.href = select.value + location.hash;
});
