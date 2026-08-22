import { confirm } from "@qino/u2/js/dialog/dialog.js";

import { api, h, t } from "../cms.js";

export const css = `
qino-cms .-media > summary { display:flex; gap:.5rem; }
qino-cms .-media > summary output { margin-left:auto; }
qino-cms .-media .-tools { display:flex; flex-wrap:wrap; gap:.5rem; margin-block:.75rem; }
qino-cms .-media ul { list-style:none; padding:0; }
qino-cms .-media li { display:grid; grid-template-columns:3.5rem 1fr auto; gap:.5rem; align-items:center; }
qino-cms .-media img { max-width:3.5rem; max-height:3.5rem; }
qino-cms .-media .-file { min-width:0; overflow-wrap:anywhere; }
`;

const inline = file => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onerror = () => reject(reader.error);
  reader.onload = () => resolve(String(reader.result).replace(";base64,", `;name=${file.name.replace(/[;,]/g, "_")};base64,`));
  reader.readAsDataURL(file);
});

const size = value => value ? `${Math.ceil(value / 1024)} KB` : "";

export default async function (el, { node, signal }) {
  const ref = api.cms.node(node.id);
  const files = await ref.files.get({}, { signal });
  const entries = Object.entries(files);
  const count = entries.filter(([, file]) => !file.placeholder).length;
  const details = h("details", { class: "-media", open: true });
  const summary = h("summary", {}, await t`Files`, h("output", {}, String(count)));
  const upload = h("input", { type: "file", multiple: true });
  const existing = h("input", { type: "text", placeholder: await t`Existing file URL or ID` });
  const add = h("button", { type: "button" }, await t`Add`);
  const order = h("select", {},
    h("option", { value: "" }, await t`Sort…`),
    h("option", { value: "name" }, await t`Name`),
    h("option", { value: "name_reverse" }, await t`Name reversed`),
    h("option", { value: "date" }, await t`Date`),
    h("option", { value: "reverse" }, await t`Reverse`),
  );
  const doubles = h("button", { type: "button" }, await t`Delete duplicates`);
  const all = h("button", { type: "button" }, await t`Delete all`);
  const tools = h("div", { class: "-tools" }, upload, existing, add, order, doubles, all);
  const list = h("ul");

  for (const [slot, file] of entries) {
    const preview = file.placeholder
      ? h("span", {}, "□")
      : file.mime?.startsWith("image/")
        ? h("img", { src: file.url, alt: "" })
        : h("span", {}, file.mime?.split("/").pop() || "file");
    const link = file.placeholder
      ? h("span", {}, `${slot} · ${await t`Placeholder`}`)
      : h("a", { href: file.url, target: "_blank", class: "-file" }, file.name || slot, size(file.size) && ` · ${size(file.size)}`);
    const remove = h("button", { type: "button", title: await t`Delete` }, "×");
    remove.addEventListener("click", async () => {
      if (!await confirm(await t`Really delete this file?`)) return;
      await ref.files(slot).delete();
      el.reload();
    }, { signal });
    list.append(h("li", {}, preview, link, remove));
  }

  upload.addEventListener("change", async () => {
    for (const file of upload.files) await ref.files.post({ file: await inline(file) });
    el.reload();
  }, { signal });
  add.addEventListener("click", async () => {
    if (!existing.value.trim()) return;
    await ref.files.post({ file: existing.value.trim() });
    el.reload();
  }, { signal });
  order.addEventListener("change", async () => {
    if (!order.value) return;
    await ref.files.order.post({ by: order.value });
    el.reload();
  }, { signal });
  doubles.addEventListener("click", async () => {
    await ref.files.doubles.delete();
    el.reload();
  }, { signal });
  all.addEventListener("click", async () => {
    if (!await confirm(await t`Really delete all files?`)) return;
    await ref.files.all.delete();
    el.reload();
  }, { signal });

  details.append(summary, tools, list);
  el.replaceChildren(details);
}
