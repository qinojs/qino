import { nodePanel } from "@qino/m/cms.backend/pub/js/node.mjs";
import { initNode } from "@qino/m/cms/pub/js/cms.js";

initNode("backend.system.cron", (el) => {
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
