import { apt } from "../../core/pub/js/qino.js";

cms.initNode("backend.superuser.cron", (el) => {
  const node = apt.cms.node(Number(cms.el.nid(el)));
  const list = el.querySelector("[cms-part=list]");
  let busy = false;

  const show = async (message) => (await import("@qino/u2/js/dialog/dialog.js")).alert(message);
  const refresh = async () => {
    list.innerHTML = await node.html.part("list").get();
  };
  const execute = async (button, data) => {
    if (busy) return;
    busy = true;
    button.disabled = true;
    try {
      const response = await node.api.post(data);
      await refresh();
      await show(response?.message || "");
    } catch (e) {
      await show(e?.message || String(e));
    } finally {
      busy = false;
      button.disabled = false;
    }
  };

  el.addEventListener("click", (event) => {
    const job = event.target.closest("[data-run-job]");
    const due = event.target.closest("[data-run-due]");
    const reload = event.target.closest("[data-refresh]");
    if (job) execute(job, { runJob: job.dataset.runJob });
    else if (due) execute(due, { runDue: true });
    else if (reload) refresh().catch((e) => show(e?.message || String(e)));
  });
});
