import { nodePanel } from "@qino/m/cms.backend/pub/js/node.mjs";

cms.initNode("backend.hosting", (el) => {
  const { node, refresh, alert: show } = nodePanel(el, ["list"]);
  let busy = false;

  /** One call at a time; the list follows what it changed. */
  const run = async (control, data, done = () => refresh()) => {
    if (busy) return;
    busy = true;
    control.disabled = true;
    try {
      await done(await node.api.post(data));
    } catch (e) {
      await show(e?.message || String(e));
    } finally {
      busy = false;
      control.disabled = false;
    }
  };

  el.addEventListener("click", (event) => {
    if (event.target.closest("[data-refresh]")) return refresh().catch((e) => show(e?.message || String(e)));
    const button = event.target.closest("[data-verb]");
    if (!button) return;
    const { verb, name } = button.dataset;
    if (verb === "log") run(button, { verb, name }, (res) => show(res.log));
    else if (verb === "delete") run(button, { verb, name }, async (res) => {
      await refresh();
      await show(`${res.archive}${res.stillServed.length ? `\n\nStill in Caddy: ${res.stillServed.join(", ")}` : ""}`);
    });
    else run(button, { verb, name });
  });

  el.addEventListener("submit", (event) => {
    const form = event.target.closest("form.-create");
    if (!form) return;
    event.preventDefault();
    const data = { verb: "create", domain: form.elements.domain.value.trim(), template: form.elements.template.value };
    run(form.querySelector("button"), data, async (res) => {
      await refresh();
      await show(`${res.name} :${res.port}`);
    });
  });
});
