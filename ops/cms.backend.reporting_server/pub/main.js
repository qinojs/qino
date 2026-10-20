import { nodePanel } from "@qino/m/cms.backend/pub/js/node.mjs";

cms.initNode("backend.reporting_server", (el) => {
  const { node, refresh, alert: show } = nodePanel(el, ["instances", "errors"]);
  const run = (promise) => promise.then(refresh).catch((e) => show(e?.message || String(e)));

  el.addEventListener("click", (event) => {
    const error = event.target.closest("[data-delete-error]");
    const instance = event.target.closest("[data-delete-instance]");
    if (error) run(node.api.post({ deleteError: error.dataset.deleteError }));
    else if (instance) run(node.api.post({ deleteInstance: instance.dataset.deleteInstance }));
    else if (event.target.closest("[data-refresh]")) run(Promise.resolve());
  });
});
