import { api } from "@qino/pub/api.js";
import { unhee } from "@qino/pub/html.js";
import { t } from "@qino/pub/t.js";

import { qgfileUpload } from "../../cms/pub/js/fileHelpers.mjs";

// the edited texts, in column order (their labels are the column heads); the image follows them
const NAMES = ["_title", "_description", "_share_title", "_share_description"];

/** Upload into the page's file slot "share", through the CMS upload. */
const upload = (pid, file) => new Promise((ok, fail) => qgfileUpload(file, "cmsPageFile", {
  url: location.pathname + "?cmspid=" + pid + "&replace=share",
  complete: (res) => { res = JSON.parse(res); res.error ? fail(new Error(res.error)) : ok(res); },
}));

cms.initNode("backend.cms.tree.seo", (el) => {
  const reload = (vars = {}) => cms.reloadPart(cms.el.nid(el), "list", vars);

  el.querySelector(".cmsBeTree")?.addEventListener("click", async (e) => {
    const toggle = e.target.closest("[data-toggle-id]");
    if (toggle) {
      e.preventDefault();
      return reload({ toggleOpen: toggle.dataset.toggleId, value: toggle.dataset.toggleValue });
    }
    const row = e.target.closest("tr[data-pid]");
    if (!row || e.target.closest("a, button")) return;
    const { pid, lang, title } = row.dataset;
    const ref = api.cms.node(pid);
    const texts = await ref.texts.get({ values: true, lang, names: NAMES.join(",") }); // creates missing ones
    const value = (name) => unhee(texts[name]?.value);
    const labels = [...el.querySelectorAll(".cmsBeTree thead th")].slice(2).map((th) => th.textContent.trim());
    const placeholders = [title, "", value("_title") || title, value("_description")];
    const { form, alert } = await import("@qino/u2/js/dialog/dialog.js");
    const removeLabel = "share" in row.dataset ? await t`Delete image` : "";
    const data = await form({
      body: "<b></b><u2-fields></u2-fields>",
      init(dialog) {
        dialog.style.width = "40rem";
        dialog.querySelector("b").textContent = title;
        const fields = dialog.querySelector("u2-fields");
        const field = (tag, label, props) => fields.append(label, Object.assign(document.createElement(tag), props));
        NAMES.forEach((name, i) => field(name.endsWith("description") ? "textarea" : "input", labels[i],
          { name, value: value(name), placeholder: placeholders[i], rows: 3 }));
        field("input", labels[4], { type: "file", name: "image", accept: "image/*" });
        if (removeLabel) field("input", removeLabel, { type: "checkbox", name: "remove" });
      },
    });
    if (!data) return;
    try {
      await Promise.all([
        ...NAMES.filter((name) => data[name] !== value(name))
          .map((name) => ref.text(name).put({ value: data[name], lang })),
        data.image?.size ? upload(pid, data.image) : data.remove ? ref.file("share").delete() : null,
      ]);
      await reload();
    } catch (error) {
      await alert(error.message);
    }
  });
});
