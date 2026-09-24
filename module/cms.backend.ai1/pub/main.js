import { nodePanel } from "@qino/m/cms.backend/pub/js/node.mjs";
import { t } from "@qino/pub/t.js";

cms.initNode("backend.ai1", (el) => {
  const { node, refresh: redraw, alert } = nodePanel(el, ["models", "providers"]);
  const row = (target) => target.closest("[data-row]");

  // Redraw the parts; unfolded models stay unfolded.
  const refresh = async () => {
    const open = [...el.querySelectorAll("[data-row=ai1_model]:has(details[open])")].map((body) => body.dataset.id);
    await redraw();
    for (const id of open) el.querySelector(`[data-row=ai1_model][data-id="${id}"] details`)?.setAttribute("open", "");
  };

  // Post an action. A failure is shown and the parts redrawn, so they show what is stored.
  const post = async (data, redraw = false) => {
    const res = await node.api.post(data).catch((e) => ({ ok: false, message: e?.message || String(e) }));
    if (!res?.ok) await alert(res?.message || await t`Error`);
    if (redraw || !res?.ok) await refresh();
    return res;
  };

  // Fields save on change: a capability cell its priority, any other named field its column.
  el.addEventListener("change", (e) => {
    const input = e.target;
    const r = row(input);
    if (!r || input.form?.dataset.add) return;
    if (input.dataset.capability) {
      const priority = input.type === "checkbox" ? (input.checked ? 0 : "") : input.value; // a need is had or not
      return post({ capability: { model: r.dataset.id, name: input.dataset.capability, priority } });
    }
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
      ? `${res.text}\n\n${res.ms} ms · ${res.usage.input} / ${res.usage.output} tokens${res.truncated ? ` · ${await t`truncated`}` : ""}`
      : res?.message || await t`Error`;
  });

  el.addEventListener("click", async (e) => {
    const button = e.target.closest("button[data-remove], button[data-key], button[data-offered]");
    if (!button) return;
    const r = row(button);
    if ("remove" in button.dataset) return post({ remove: { table: r.dataset.row, id: r.dataset.id } }, true);
    if ("key" in button.dataset) {
      const { prompt } = await import("@qino/u2/js/dialog/dialog.js");
      const value = await prompt(await t`Key for ${r.dataset.name} (empty removes it)`, "");
      if (value != null) post({ key: { provider: r.dataset.name, value } }, true);
      return;
    }
    button.disabled = true;
    const res = await node.api.post({ offered: r.dataset.id }).catch((err) => ({ ok: false, message: err?.message }));
    button.disabled = false;
    if (!res?.ok) return alert(res?.message || await t`Error`);
    await offeredDialog(r.dataset.id, r.dataset.name, res.list, new Set(res.adopted));
    refresh();
  });

  // A provider's models to search through; each one can be taken over into the matrix.
  const offeredDialog = async (provider, name, list, adopted) => {
    const { modal } = await import("@qino/u2/js/dialog/dialog.js");
    const [title, taken, takeOver, close] = await Promise.all([t`${name}: ${list.length} models`, t`taken over`, t`take over`, t`Close`]);
    return modal({
      body: `<h3></h3><input type=search><div class=-offered></div>`,
      buttons: [{ title: close, value: null }],
      init: (dialog) => {
        dialog.querySelector("h3").textContent = title;
        const search = dialog.querySelector("input");
        const box = dialog.querySelector(".-offered");
        const item = (id) => {
          const line = document.createElement("div");
          const code = line.appendChild(document.createElement("code"));
          code.textContent = id;
          if (adopted.has(id)) {
            line.append(` ✓ ${taken}`);
            return line;
          }
          const take = line.appendChild(document.createElement("button"));
          take.type = "button";
          take.textContent = takeOver;
          take.addEventListener("click", async () => {
            take.disabled = true;
            const res = await node.api.post({ adopt: { provider, id } }).catch((err) => ({ ok: false, message: err?.message }));
            if (!res?.ok) return alert(res?.message || await t`Error`);
            adopted.add(id);
            take.replaceWith(` ✓ ${taken}`);
          });
          return line;
        };
        const show = () => {
          const q = search.value.trim().toLowerCase();
          box.replaceChildren(...list.filter((id) => id.toLowerCase().includes(q)).slice(0, 200).map(item));
        };
        search.addEventListener("input", show);
        show();
      },
    });
  };

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
