import { nodePanel } from "@qino/m/cms.backend/pub/js/node.mjs";

cms.initNode("backend.superuser.security", (el) => {
  const { execute, refresh, alert } = nodePanel(el, ["list"]);

  el.addEventListener("click", (event) => {
    const release = event.target.closest("[data-release]");
    const reload = event.target.closest("[data-refresh]");
    if (release) execute(release, { release: release.dataset.release });
    else if (reload) refresh().catch((e) => alert(e?.message || String(e)));
  });
});
