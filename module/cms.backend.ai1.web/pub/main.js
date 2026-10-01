import { nodePanel } from "@qino/m/cms.backend/pub/js/node.mjs";

// Choose the reader, set a key, try a search or a read, find and remove pages.
cms.initNode("backend.ai1.web", (el) => {
  const { node, alert } = nodePanel(el);
  const post = async (data) => {
    const res = await node.api.post(data).catch((e) => ({ ok: false, message: e.message }));
    if (!res?.ok) await alert(res?.message ?? "Error");
    return res;
  };
  const find = (search = el.querySelector("[data-find]").elements.search.value) => cms.reloadPart(Number(cms.el.nid(el)), "list", { search });
  const output = el.querySelector("output");

  el.addEventListener("change", (e) => {
    if (e.target.matches("[data-reader]")) post({ reader: e.target.value });
  });
  el.addEventListener("click", async (e) => {
    const button = e.target.closest("[data-set-key], [data-remove]");
    if (!button) return;
    if ("remove" in button.dataset) return (await post({ remove: button.closest("[data-id]").dataset.id }))?.ok && find();
    const name = button.closest("[data-key]").dataset.key;
    const value = await (await import("@qino/u2/js/dialog/dialog.js")).prompt(`Key for ${name} (empty removes it)`, "");
    if (value != null && (await post({ key: { name, value } }))?.ok) location.reload();
  });
  el.addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.target;
    if (form.matches("[data-find]")) return find();
    output.textContent = "…";
    const res = form.matches("[data-search]") ? await post({ search: form.elements.query.value }) : await post({ read: form.elements.url.value });
    if (!res?.ok) return output.textContent = "";
    if (form.matches("[data-search]")) return output.textContent = res.result.map((r) => `${r.title}\n${r.url}\n${r.snippet}`).join("\n\n");
    output.textContent = `${res.result.title}\n\n${res.result.content}`;
    find();
  });
});
