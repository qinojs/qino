import { nodePanel } from "@qino/m/cms.backend/pub/js/node.mjs";

cms.initNode("backend.superuser.flow", (el) => {
  const { node, execute, alert: show } = nodePanel(el, ["list"]);
  let flow = 0;

  const showDetail = async () => {
    el.querySelector("[cms-part=detail]").innerHTML = await node.html.part("detail").post({ vars: { flow } });
  };

  // a step as it is saved: { description, fn } or { description, debounce: { ms, by } }
  const stepOf = (set) => {
    const value = (name) => set.querySelector(`[name=${name}]`)?.value ?? "";
    const description = value("description");
    if (set.dataset.step === "fn") return { description, fn: value("fn") };
    return { description, debounce: { ms: Number(value("ms")), ...value("by") && { by: value("by") } } };
  };

  el.addEventListener("change", (e) => {
    const box = e.target.closest("[data-set]");
    if (!box) return;
    execute(box, { flow: box.closest("[data-flow]").dataset.flow, set: box.dataset.set, value: box.checked });
  });

  el.addEventListener("click", (e) => {
    const add = e.target.closest("[data-add-step]");
    if (add) {
      const form = add.closest("form");
      const template = form.querySelector(`[data-step-template=${add.dataset.addStep}]`);
      form.querySelector("[data-steps]").append(template.content.cloneNode(true));
      return;
    }
    if (e.target.closest("[data-reload]")) { showDetail().catch((err) => show(err.message)); return; }
    const remove = e.target.closest("[data-remove-step]");
    if (remove) { remove.closest("[data-step]").remove(); return; }

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
    const save = {
      description: form.querySelector("u2-fields [name=description]").value, // the steps have theirs
      on: form.on.value,
      tools: form.tools.value,
      steps: [...form.querySelectorAll("[data-steps] [data-step]")].map(stepOf),
    };
    execute(button, { flow, save }).then(showDetail);
  });
});
