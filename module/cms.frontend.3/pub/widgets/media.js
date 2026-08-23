import { api, ctx, fileData, h, t } from "../cms.js";

export const css = `
qino-cms .-media > summary { display:flex; gap:.5rem; }
qino-cms .-media > summary output { margin-left:auto; }
qino-cms .-media .-tools { display:flex; flex-wrap:wrap; align-items:center; gap:.5rem; margin-block:.75rem; }
qino-cms .-media .-existing { display:flex; flex:1 1 16rem; gap:.25rem; margin:0; }
qino-cms .-media .-existing > input { flex:1; min-width:8rem; }
qino-cms .-media .-files { --u2-dropzone-strategy:move; list-style:none; margin:0; padding:0; }
qino-cms .-media .-files.\\:drop-valid { outline:1px solid var(--cms-color); }
qino-cms .-media li { display:grid; grid-template-columns:3.5rem minmax(0,1fr) auto 2rem 2rem; gap:.5rem; align-items:center; padding:.5rem 0; border-bottom:1px solid var(--cms-light); }
qino-cms .-media img { max-width:3.5rem; max-height:3.5rem; }
qino-cms .-media .-file { min-width:0; overflow-wrap:anywhere; }
qino-cms .-media .-slot { display:block; color:#777; font-size:11px; }
qino-cms .-media .-preview { display:grid; place-items:center; width:3.5rem; height:3.5rem; margin:0; padding:0; border:0; background:transparent; overflow:hidden; }
qino-cms .-media .-handle { margin:0; padding:.25rem; cursor:grab; }
qino-cms .-media .-remove { margin:0; padding:.25rem; }
qino-cms .-media .-foot { display:flex; justify-content:flex-end; margin-top:.5rem; font-size:12px; }
`;

const size = value => value ? `${Math.ceil(value / 1024)} KB` : "";

export default async function (el, { node, dialogs, signal }) {
  const ref = api.cms.node(node.id);
  const files = await ref.files.get({}, { signal });
  const entries = Object.entries(files);
  if (entries.length > 1) {
    await Promise.all([
      import("@qino/u2/attr/dropzone/dropzone.js"),
      import("@qino/u2/attr/draghandle/draghandle.js"),
    ]);
  }
  const count = entries.filter(([, file]) => !file.placeholder).length;
  const details = h("details", { class: "-media", open: true });
  const summary = h("summary", {}, await t`Files`, h("output", {}, String(count)));
  const upload = h("input", { type: "file", multiple: true, hidden: true });
  const uploadButton = h("button", { type: "button" }, await t`Upload`);
  const existing = h("input", { type: "text", placeholder: await t`Existing file URL or ID` });
  const add = h("button", { type: "submit" }, await t`Add`);
  const existingForm = h("form", { class: "-existing" }, existing, add);
  const order = h("select", {},
    h("option", { value: "" }, await t`Sort…`),
    h("option", { value: "name" }, await t`Name`),
    h("option", { value: "name_reverse" }, await t`Name reversed`),
    h("option", { value: "date" }, await t`Date`),
    h("option", { value: "reverse" }, await t`Reverse`),
  );
  const cleanup = h("select", {},
    h("option", { value: "" }, await t`Delete…`),
    h("option", { value: "doubles" }, await t`Duplicates`),
    h("option", { value: "all" }, await t`All files`),
  );
  const tools = h("div", { class: "-tools" }, upload, uploadButton, existingForm, order, cleanup);
  const list = h("ul", { class: "-files" });
  let replace;

  for (const [slot, file] of entries) {
    const preview = file.placeholder
      ? h("span", {}, "□")
      : file.mime?.startsWith("image/")
        ? h("img", { src: file.url, alt: "" })
        : h("span", {}, file.mime?.split("/").pop() || "file");
    const previewButton = h("button", { type: "button", class: "-preview", title: await t`Click to replace the file` }, preview);
    const link = h("span", { class: "-file" },
      file.placeholder
        ? await t`Placeholder`
        : h("a", { href: file.url, target: "_blank" }, file.name || slot),
      h("small", { class: "-slot" }, slot),
    );
    const handle = h("button", { type: "button", class: "-handle", hidden: entries.length < 2, title: await t`Move`, "aria-label": await t`Move`, "u2-draghandle": true }, "⠿");
    const remove = h("button", { type: "button", class: "-remove", title: await t`Delete`, "aria-label": await t`Delete` }, "×");
    remove.addEventListener("click", async () => {
      if (!await dialogs.confirm(t`Really delete this file?`)) return;
      await ref.files(slot).delete();
      el.reload();
    }, { signal });
    previewButton.addEventListener("click", () => {
      replace = slot;
      upload.multiple = false;
      upload.click();
    }, { signal });
    const row = h("li", { "data-slot": slot }, previewButton, link, h("span", {}, size(file.size)), handle, remove);
    row.setAttribute("draggable", "false");
    list.append(row);
  }

  uploadButton.addEventListener("click", () => {
    replace = null;
    upload.multiple = true;
    upload.click();
  }, { signal });
  upload.addEventListener("change", async () => {
    for (const file of upload.files) await ref.files.post({ file: await fileData(file), replace: replace || undefined });
    upload.value = "";
    replace = null;
    el.reload();
  }, { signal });
  existingForm.addEventListener("submit", async event => {
    event.preventDefault();
    if (!existing.value.trim()) return;
    await ref.files.post({ file: existing.value.trim() });
    el.reload();
  }, { signal });
  order.addEventListener("change", async () => {
    if (!order.value) return;
    await ref.files.order.post({ by: order.value });
    el.reload();
  }, { signal });
  cleanup.addEventListener("change", async () => {
    if (cleanup.value === "doubles") await ref.files.doubles.delete();
    if (cleanup.value === "all") {
      if (!await dialogs.confirm(t`Really delete all files?`)) {
        cleanup.value = "";
        return;
      }
      await ref.files.all.delete();
    }
    el.reload();
  }, { signal });
  if (entries.length > 1) {
    list.setAttribute("u2-dropzone", "");
    list.addEventListener("u2-dropzone-drop", async event => {
      if (!event.detail?.add) return;
      try {
        await ref.files.put({ sort: [...list.children].map(row => row.dataset.slot) });
      } catch (error) {
        await dialogs.alert(error?.message || String(error));
        el.reload();
      }
    }, { signal });
  }

  const foot = count
    ? h("div", { class: "-foot" }, h("a", { href: `${ctx.appUrl}?cms_nodeFilesZip=${node.id}`, target: "_blank" }, `${count} ${await t`Files`} · ${await t`Download ZIP`}`))
    : null;
  details.append(summary, h("div", { class: "-body" }, tools, list, foot));
  el.replaceChildren(details);
}
