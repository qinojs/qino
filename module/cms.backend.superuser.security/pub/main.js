import { nodePanel } from "@qino/m/cms.backend/pub/js/node.mjs";
import "@qino/m/core/pub/js/SettingsEditor.mjs";

cms.initNode("backend.superuser.security", (el) => {
  const { execute, refresh, alert } = nodePanel(el, ["suspects", "recent"]);

  el.addEventListener("click", (event) => {
    const release = event.target.closest("[data-release]");
    if (release) execute(release, { release: release.dataset.release });
    else if (event.target.closest("[data-refresh]")) refresh().catch((e) => alert(e?.message || String(e)));
  });
});
