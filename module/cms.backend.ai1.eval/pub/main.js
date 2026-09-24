import { nodePanel } from "@qino/m/cms.backend/pub/js/node.mjs";
import { t } from "@qino/pub/t.js";

cms.initNode("backend.ai1.eval", (el) => {
  const { execute } = nodePanel(el, ["list"]);

  el.addEventListener("click", async (e) => {
    const evaluate = e.target.closest("[data-evaluate]");
    const key = e.target.closest("[data-key]");
    if (evaluate) execute(evaluate, { evaluate: true });
    if (!key) return;
    const { prompt } = await import("@qino/u2/js/dialog/dialog.js");
    const value = await prompt(await t`Artificial Analysis API key (empty removes it)`, "");
    if (value != null) execute(key, { key: value });
  });
});
