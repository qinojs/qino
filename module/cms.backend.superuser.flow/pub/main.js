import { nodePanel } from "@qino/m/cms.backend/pub/js/node.mjs";

cms.initNode("backend.superuser.flow", (el) => {
  const { node, execute, alert: show } = nodePanel(el, ["list"]);
  let flow = 0;

  const showDetail = async () => {
    el.querySelector("[cms-part=detail]").innerHTML = await node.html.part("detail").post({ vars: { flow } });
  };

  el.addEventListener("change", (e) => {
    const box = e.target.closest("[data-set]");
    if (!box) return;
    execute(box, { flow: box.closest("[data-flow]").dataset.flow, set: box.dataset.set, value: box.checked });
  });

  el.addEventListener("click", (e) => {
    if (e.target.closest("[data-reload]")) { showDetail().catch((err) => show(err.message)); return; }

    const del = e.target.closest("[data-delete]");
    if (del) {
      e.preventDefault();
      execute(del, { flow: del.closest("[data-flow]").dataset.flow, delete: true })
        .then(() => (flow = 0, showDetail()));
      return;
    }
    const row = e.target.closest("[data-flow]");
    if (!row || e.target.closest("input, button")) return;
    flow = Number(row.dataset.flow);
    showDetail().catch((err) => show(err.message));
  });

  el.addEventListener("submit", (e) => {
    e.preventDefault();
    const form = e.target;
    const button = form.querySelector("button:not([type=button])");
    if (form.matches("[data-test]")) return execute(button, { flow, event: form.event.value });
    if (!form.matches("[data-edit]")) return;
    const { description, on, ms, by, tools, code } = form.elements;
    const save = { description: description.value, on: on.value, ms: ms.value, by: by.value, tools: tools.value,
      code: code.value };
    execute(button, { flow, save }).then(showDetail);
  });
});
