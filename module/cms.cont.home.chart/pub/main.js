cms.initNode("cont.home.chart", (el) => {
  el.addEventListener("submit", async (event) => {
    const form = event.target.closest("form[data-period]");
    if (!form) return;
    event.preventDefault();
    const button = form.querySelector("button[type=submit]");
    if (button.disabled) return;
    button.disabled = true;
    try {
      await cms.reloadPart(Number(cms.el.nid(el)), "plot", { start: form.elements.start.value, end: form.elements.end.value });
    } catch (error) {
      await (await import("@qino/u2/js/dialog/dialog.js")).alert(error?.message || String(error));
    } finally { button.disabled = false; }
  });
});
