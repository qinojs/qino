import { nodePanel } from "@qino/m/cms.backend/pub/js/node.mjs";

cms.initNode("backend.ai1.embed", (el) => {
  const { node, alert } = nodePanel(el, []);
  const post = async (data) => {
    const res = await node.api.post(data).catch((e) => ({ ok: false, message: e.message }));
    if (!res?.ok) await alert(res?.message ?? "Error");
    return res;
  };
  el.addEventListener("change", async (event) => {
    const input = event.target;
    if (input.matches("[data-auto]") && !(await post({ auto: input.checked }))?.ok) input.checked = !input.checked;
    if (input.matches("[data-primary]") && !(await post({ primary: input.closest("[data-id]").dataset.id }))?.ok) location.reload();
  });
  el.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-drop]");
    if (button && (await post({ drop: button.closest("[data-id]").dataset.id }))?.ok) location.reload();
  });
  el.addEventListener("submit", async (event) => {
    const form = event.target, data = Object.fromEntries(new FormData(form));
    event.preventDefault();
    if (form.matches("[data-create]")) {
      if ((await post({ create: data }))?.ok) location.reload();
    } else if (form.matches("[data-config]")) {
      await post({ config: data });
    } else if (form.matches("[data-sync]")) {
      const button = form.querySelector("button");
      button.disabled = true;
      const res = await post({ sync: true });
      button.disabled = false;
      if (res?.ok) {
        const { nodes, files, errors } = res.result;
        await alert(`${nodes} nodes, ${files} files${errors.length ? `\n\n${errors.join("\n")}` : ""}`);
        location.reload();
      }
    } else if (form.matches("[data-search]")) {
      const res = await post({ search: data.query });
      if (!res?.ok) return;
      const table = el.querySelector("[data-hits]");
      table.replaceChildren(...res.hits.map((hit) => {
        const tr = document.createElement("tr");
        for (const text of [hit.score.toFixed(3), hit.name, Object.values(hit.key).join(", "), hit.content.slice(0, 160)]) {
          tr.insertCell().textContent = text;
        }
        return tr;
      }));
      if (!res.hits.length) table.insertRow().insertCell().textContent = "No matches";
    }
  });
});
