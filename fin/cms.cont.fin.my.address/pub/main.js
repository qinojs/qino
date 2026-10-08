import { api } from "@qino/pub/api.js";
import { t } from "@qino/pub/t.js";

const fin = api.fin;

cms.initNode("cont.fin.my.address", async (el) => {
  const form = el.matches("form") ? el : el.querySelector("[data-address]");
  const msg = form.querySelector(".-msg");
  const fields = [...form.elements].filter((e) => e.name);
  const labels = { saved: await t`Saved.`, error: await t`Error loading.` };
  const show = (value = "") => void (msg.value = value);

  try {
    const address = await fin.address.get();
    for (const field of fields) field.value = address[field.name] ?? "";
  } catch (e) { show(labels.error + " " + (e?.message || String(e))); }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    show();
    try {
      await fin.address.put(Object.fromEntries(fields.map((f) => [f.name, f.value.trim()])));
      show(labels.saved);
    } catch (e) { show(e?.message || String(e)); }
  });
});
