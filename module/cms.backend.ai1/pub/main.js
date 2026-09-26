import { nodePanel } from "@qino/m/cms.backend/pub/js/node.mjs";
import { t } from "@qino/pub/t.js";

cms.initNode("backend.ai1", (el) => {
  const { node, alert } = nodePanel(el, []);
  const nid = Number(cms.el.nid(el));
  const row = (target) => target.closest("[data-row]");
  const filter = el.querySelector("[data-filter]");

  // The view with the current filter; an open providers dialog shows the new state too.
  const vars = () => ({ ...Object.fromEntries(new URL(location).searchParams), ...(filter ? Object.fromEntries(new FormData(filter)) : {}) });
  let dialog; // the open providers dialog: { id, box }
  const fill = () => dialog.box.replaceChildren(el.querySelector(`[data-row=ai1_model][data-id="${dialog.id}"] template`).content.cloneNode(true));
  const refresh = async () => {
    await cms.reloadPart(nid, "view", vars());
    if (dialog) fill();
  };

  // A model's providers, in a dialog inside the module, so the same handlers serve it.
  const offers = async (r) => {
    const { modal } = await import("@qino/u2/js/dialog/dialog.js");
    await modal({
      body: "<h3></h3><div></div>",
      root: el,
      buttons: [{ title: await t`Close`, value: null }],
      init: (element) => {
        element.querySelector("h3").textContent = r.dataset.name;
        dialog = { id: r.dataset.id, box: element.querySelector("h3 + div") };
        fill();
      },
    });
    dialog = undefined;
  };

  // Post an action. A failure is shown and the view redrawn, so it shows what is stored.
  const post = async (data, redraw = false) => {
    const res = await node.api.post(data).catch((e) => ({ ok: false, message: e?.message || String(e) }));
    if (!res?.ok) await alert(res?.message || await t`Error`);
    if (redraw || !res?.ok) await refresh();
    return res;
  };

  // The filter lives in the address too, so a reload or a link shows the same.
  let timer;
  filter?.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const url = new URL(location);
      for (const k of ["q", "provider", "capability", "sort", "all"]) {
        const v = new FormData(filter).get(k);
        v ? url.searchParams.set(k, String(v)) : url.searchParams.delete(k);
      }
      history.replaceState(null, "", url);
      refresh();
    }, 250);
  });

  // Fields save on change: a capability cell whether the model has it, any other named field its column.
  el.addEventListener("change", (e) => {
    const input = e.target;
    const r = row(input);
    if (!r || input.form?.dataset.add) return;
    if (input.dataset.capability) return post({ capability: { model: r.dataset.id, name: input.dataset.capability, on: input.checked } });
    if (!input.name) return;
    const value = input.type === "checkbox" ? input.checked : input.value;
    post({ set: { table: r.dataset.row, id: r.dataset.id, column: input.name, value } }, ["type", "provider_id", "enabled"].includes(input.name));
  });

  el.addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.target;
    if ("filter" in form.dataset) return;
    if (form.dataset.add) return post({ add: form.dataset.add, model: row(form)?.dataset.id, ...Object.fromEntries(new FormData(form)) }, true);

    // Try: the chosen capability through the normal choice of model
    const output = form.querySelector(":scope > output");
    const button = form.querySelector("button");
    let data;
    try { data = await input(); }
    catch (err) { output.textContent = err.message; return; }
    button.disabled = true;
    output.textContent = "…";
    const res = await node.api.post({ try: { capability: form.elements.capability.value, input: data, model: form.elements.model.value, prefer: prefer() } })
      .catch((err) => ({ ok: false, message: err?.message }));
    button.disabled = false;
    if (!res?.ok) return output.textContent = res?.message || await t`Error`;
    const by = document.createElement("pre");
    by.textContent = `${res.tried.map((c) => `${c.model} @ ${c.provider}${c.error ? ` ✕ ${c.error}` : " ✓"}`).join("\n")}\n${res.ms} ms`;
    output.replaceChildren(...await shown(form.elements.capability.value, res.result), by);
  });

  el.addEventListener("click", async (e) => {
    const button = e.target.closest("button[data-remove], button[data-key], button[data-benchmark-key], button[data-evaluate], button[data-switch], button[data-offers], button[type=button][data-add]");
    if (!button) return;
    const r = row(button);
    if ("offers" in button.dataset) return offers(r);
    if (button.dataset.add) return post({ add: button.dataset.add, model: button.dataset.model, provider_id: button.previousElementSibling.value }, true);
    if ("remove" in button.dataset) return post({ remove: { table: r.dataset.row, id: r.dataset.id } }, true);
    if (button.dataset.switch) return post({ switch: { ...vars(), on: button.dataset.switch === "on" } }, true).then((res) => res?.ok && alert(res.message));
    const { prompt } = await import("@qino/u2/js/dialog/dialog.js");
    if ("key" in button.dataset) {
      const value = await prompt(await t`Key for ${r.dataset.name} (empty removes it)`, "");
      if (value != null) post({ key: { provider: r.dataset.name, value } }, true);
      return;
    }
    if ("benchmarkKey" in button.dataset) {
      const value = await prompt(await t`Artificial Analysis API key (empty removes it)`, "");
      if (value != null) post({ benchmarkKey: value }).then((res) => res?.ok && alert(res.message));
      return;
    }
    button.disabled = true;
    const res = await post({ evaluate: true }, true);
    button.disabled = false;
    if (res?.ok) alert(res.message);
  });

  // Try: fields for the chosen capability, the weights from the sliders; who would answer, updated
  // as capability, model and weights change
  const tryForm = el.querySelector(".-try form");
  const prefer = () => Object.fromEntries([...el.querySelectorAll("[data-weight]")].filter((i) => +i.value).map((i) => [i.dataset.weight, +i.value]));
  const dataUrl = (file) => new Promise((resolve) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.readAsDataURL(file); });
  const input = async () => {
    const f = tryForm.elements, prompt = f.prompt.value, file = f.file.files[0];
    return {
      text: () => ({ messages: [{ role: "user", content: prompt }] }),
      structured: () => ({ messages: [{ role: "user", content: prompt }], schema: JSON.parse(f.schema.value) }),
      translate: () => ({ text: prompt, to: f.to.value, ...(f.from.value && { from: f.from.value }) }),
      decide: () => ({ content: prompt, ...(f.question.value && { question: f.question.value }), options: f.options.value.split(",").map((o) => o.trim()).filter(Boolean) }),
      embed: () => ({ texts: prompt.split("\n").filter(Boolean) }),
      image: () => ({ prompt }),
      speak: () => ({ text: prompt, ...(f.voice.value && { voice: f.voice.value }) }),
      transcribe: async () => file ? { file: await dataUrl(file), name: file.name } : {},
    }[f.capability.value]();
  };
  // the answer as fits it: images as images, vectors by their size, the rest as text
  const shown = async (capability, result) => {
    if (capability === "image") return result.map((src) => Object.assign(document.createElement("img"), { src }));
    if (capability === "speak") return [Object.assign(document.createElement("audio"), { src: result, controls: true })];
    const text = {
      text: () => result.text + (result.truncated ? " …" : ""),
      decide: () => `${result.choice}${result.probabilities ? `\n${JSON.stringify(result.probabilities)}` : ""}`,
      embed: () => `${result.length} × ${result[0]?.length ?? 0}`,
      translate: () => [result].flat().join("\n"),
      transcribe: () => result.text,
    }[capability]?.() ?? JSON.stringify(result, null, 2);
    return [Object.assign(document.createElement("pre"), { textContent: text })];
  };
  const preview = async () => {
    const data = await input().catch(() => ({}));
    const res = await node.api.post({ preview: { capability: tryForm.elements.capability.value, input: data, model: tryForm.elements.model.value, prefer: prefer() } })
      .catch((e) => ({ message: e?.message }));
    tryForm.querySelector(".-candidates").replaceChildren(...(res?.list?.length ? res.list : [{ model: res?.message ?? "–" }]).map((c) => {
      const li = document.createElement("li");
      li.textContent = c.provider ? `${c.model} @ ${c.provider}${c.via ? ` · via ${c.via}` : ""} (${c.rank})` : c.model;
      return li;
    }));
  };
  let previewing;
  if (tryForm) {
    tryForm.elements.capability.addEventListener("change", () => {
      for (const field of tryForm.querySelectorAll("[data-for]")) field.hidden = !field.dataset.for.split(" ").includes(tryForm.elements.capability.value);
      preview();
    });
    tryForm.elements.model.addEventListener("change", preview);
    tryForm.addEventListener("input", (e) => {
      if (!e.target.dataset.weight) return;
      e.target.closest("tr").querySelector("output").textContent = e.target.value;
      clearTimeout(previewing);
      previewing = setTimeout(preview, 150);
    });
    preview();
  }

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
