// The fragment never reaches the server, so the language switch carries it over here.
// Delegated on document: this runs on frontend layouts too, which have no cms.mjs.
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
