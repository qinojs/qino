import { nodePanel } from "../../cms.backend/pub/js/node.mjs";

cms.initNode("backend.superuser.cron", (el) => {
  const { execute, refresh, alert: show } = nodePanel(el, ["list"]);

  el.addEventListener("click", (event) => {
    const job = event.target.closest("[data-run-job]");
    const due = event.target.closest("[data-run-due]");
    const reload = event.target.closest("[data-refresh]");
    if (job) execute(job, { runJob: job.dataset.runJob });
    else if (due) execute(due, { runDue: true });
    else if (reload) refresh().catch((e) => show(e?.message || String(e)));
  });
});
