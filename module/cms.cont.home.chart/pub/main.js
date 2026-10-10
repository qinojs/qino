import "@qino/u2/el/time/time.js";

// datetime-local holds the browser's local time; the server speaks ISO with timezone.
const local = (iso) => {
  const date = new Date(iso);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

cms.initNode("cont.home.chart", (el) => {
  let busy = false;
  const fill = () => {
    const form = el.querySelector("form[data-period]");
    if (!form) return;
    form.elements.start.value = local(form.dataset.start);
    form.elements.end.value = local(form.dataset.end);
  };
  const show = async (start, end) => {
    if (busy) return;
    busy = true;
    try {
      const period = { start: new Date(start).toISOString(), end: new Date(end).toISOString() };
      await cms.reloadPart(Number(cms.el.nid(el)), "plot", period);
      fill();
    } catch (error) {
      await (await import("@qino/u2/js/dialog/dialog.js")).alert(error?.message || String(error));
    } finally { busy = false; }
  };
  fill();

  el.addEventListener("click", (event) => {
    const button = event.target.closest("form[data-period] button[type=button]");
    if (!button) return;
    const { span, shift } = button.dataset, now = Date.now();
    if (span) return show(now - span * 1000, now);
    const start = Date.parse(button.form.dataset.start), end = Date.parse(button.form.dataset.end);
    show(start + (end - start) * shift, end + (end - start) * shift);
  });

  el.addEventListener("submit", (event) => {
    const form = event.target.closest("form[data-period]");
    if (!form) return;
    event.preventDefault();
    show(form.elements.start.value, form.elements.end.value);
  });
});
