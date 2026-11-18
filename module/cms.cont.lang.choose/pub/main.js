// Keep the URL fragment when switching language (the server never sees it).
import { initNode } from "@qino/m/cms/pub/js/cms.js";

initNode("cont.lang.choose", (el) => {
  el.addEventListener("click", (e) => {
    const a = e.target.closest("a[hreflang]");
    if (!a || !location.hash) return;
    e.preventDefault();
    location.href = a.href + location.hash;
  });
  el.addEventListener("change", (e) => {
    const select = e.target.closest("select");
    if (select) location.href = select.value + location.hash;
  });
});
