import { nodePanel } from "@qino/m/cms.backend/pub/js/node.mjs";

cms.initNode("backend.ai1", (el) => {
  const { node, refresh, alert } = nodePanel(el, ["models", "providers"]);
  const row = (target) => target.closest("[data-row]");

  // Post an action. A failure is shown and the parts redrawn, so they show what is stored.
  const post = async (data, redraw = false) => {
    const res = await node.api.post(data).catch((e) => ({ ok: false, message: e?.message || String(e) }));
    if (!res?.ok) await alert(res?.message || "Error");
    if (redraw || !res?.ok) await refresh();
    return res;
  };

  // Fields save on change: a capability cell its priority, any other named field its column.
  el.addEventListener("change", (e) => {
    const input = e.target;
    const r = row(input);
    if (!r || input.form?.dataset.add) return;
    if (input.dataset.capability) return post({ capability: { model: r.dataset.id, name: input.dataset.capability, priority: input.value } });
    if (!input.name) return;
    const value = input.type === "checkbox" ? input.checked : input.value;
    post({ set: { table: r.dataset.row, id: r.dataset.id, column: input.name, value } }, ["type", "provider_id"].includes(input.name));
  });

  el.addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.target;
    if (form.dataset.add) return post({ add: form.dataset.add, model: row(form)?.dataset.id, ...Object.fromEntries(new FormData(form)) }, true);

    // Try: one prompt through the normal choice of model
    const output = form.querySelector("output");
    const button = form.querySelector("button");
    button.disabled = true;
    output.textContent = "…";
    const res = await node.api.post({ try: Object.fromEntries(new FormData(form)) }).catch((err) => ({ ok: false, message: err?.message }));
    button.disabled = false;
    output.textContent = res?.ok
      ? `${res.text}\n\n${res.ms} ms · ${res.usage.input} / ${res.usage.output} tokens${res.truncated ? " · truncated" : ""}`
      : res?.message || "Error";
  });

  el.addEventListener("click", async (e) => {
    const button = e.target.closest("button[data-remove], button[data-key], button[data-check]");
    if (!button) return;
    const r = row(button);
    if ("remove" in button.dataset) return post({ remove: { table: r.dataset.row, id: r.dataset.id } }, true);
    if ("key" in button.dataset) {
      const { prompt } = await import("@qino/u2/js/dialog/dialog.js");
      const value = await prompt(`Key for ${r.dataset.name} (empty removes it)`, "");
      if (value != null) post({ key: { provider: r.dataset.name, value } }, true);
      return;
    }
    button.disabled = true;
    const res = await post({ check: r.dataset.id });
    button.disabled = false;
    if (res?.ok) alert(res.message);
  });

  // A provider's model names as suggestions, fetched once per provider on first focus.
  const offered = new Map();
  el.addEventListener("focusin", async (e) => {
    const provider = e.target.dataset?.provider;
    if (!provider) return;
    if (!offered.has(provider)) offered.set(provider, node.api.post({ offered: provider }).then((res) => res?.list ?? [], () => []));
    const list = el.querySelector(`#ai1-offered-${provider}`);
    if (list && !list.children.length) list.replaceChildren(...(await offered.get(provider)).map((id) => new Option(id, id)));
  });

  // Picking a known provider fills in its type and endpoint.
  el.addEventListener("input", (e) => {
    const form = e.target.closest("form[data-catalog]");
    if (!form || e.target.name !== "name") return;
    const entry = JSON.parse(form.dataset.catalog).find((c) => c.name === e.target.value);
    if (!entry) return;
    form.elements.type.value = entry.type;
    form.elements.endpoint.value = entry.endpoint;
  });
});
