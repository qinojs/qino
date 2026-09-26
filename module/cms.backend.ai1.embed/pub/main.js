import { nodePanel } from "@qino/m/cms.backend/pub/js/node.mjs";

cms.initNode("backend.ai1.embed", (el) => {
  const { node, alert } = nodePanel(el, []);
  const post = async (data) => {
    const res = await node.api.post(data).catch((e) => ({ ok: false, message: e.message }));
    if (!res?.ok) await alert(res?.message ?? "Error");
    return res;
  };
  el.addEventListener("change", async (event) => {
    if (event.target.matches("[data-auto]")) {
      if (!(await post({ auto: event.target.checked }))?.ok) event.target.checked = !event.target.checked;
      return;
    }
    if (!event.target.matches("[data-enable]")) return;
    const res = await post({ enable: { id: event.target.closest("tr").dataset.id, on: event.target.checked } });
    if (!res?.ok) location.reload();
  });
  el.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-remove]");
    if (button && (await post({ remove: button.closest("tr").dataset.id }))?.ok) location.reload();
  });
  el.addEventListener("submit", async (event) => {
    const form = event.target;
    event.preventDefault();
    if (form.matches("[data-add]")) {
      if ((await post({ add: Object.fromEntries(new FormData(form)) }))?.ok) location.reload();
    } else if (form.matches("[data-config]")) {
      if ((await post({ config: Object.fromEntries(new FormData(form)) }))?.ok) location.reload();
    } else if (form.matches("[data-sync]")) {
      const button = form.querySelector("button");
      button.disabled = true;
      const res = await post({ sync: form.elements.collection.value });
      button.disabled = false;
      if (res?.ok) {
        await alert(JSON.stringify(res.result));
        location.reload();
      }
    } else if (form.matches("[data-search]")) {
      const res = await post({ search: Object.fromEntries(new FormData(form)) });
      if (res?.ok) form.querySelector("output").textContent = res.hits.map((h) => `${h.score.toFixed(3)} ${h.table}/${h.id} ${h.part}: ${h.content.slice(0, 120)}`).join("\n") || "No matches";
    }
  });
});
