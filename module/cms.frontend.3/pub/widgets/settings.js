import { api, cms, ctx, h, t } from "../cms.js";

export const css = `
qino-cms .-settings > summary { display:flex; gap:.5rem; align-items:center; }
qino-cms .-settings > summary output { margin-left:auto; }
qino-cms .-settings .-intro { display:grid; grid-template-columns:1fr 3rem; gap:.75rem; align-items:center; margin-bottom:.75rem; }
qino-cms .-settings .-intro > img { width:3rem; height:3rem; object-fit:contain; }
qino-cms .-settings .-intro strong { display:block; font-size:1.15em; }
qino-cms .-settings .-general { display:grid; grid-template-columns:repeat(auto-fit,minmax(13rem,1fr)); gap:.75rem; margin-block:.75rem; }
qino-cms .-settings label { display:grid; gap:.2rem; }
qino-cms .-settings label.-check { display:flex; flex-direction:row; align-items:center; }
`;

const generic = async (target, id) => {
  await import("@qino/pub/SettingsEditor.mjs");
  target.replaceWith(h("settings-editor", { source: `cms/node/${id}/settings` }));
};

export default async function (el, { node, dialogs, signal }) {
  const ref = api.cms.node(node.id);
  const [current, modules] = await Promise.all([
    ref.get({}, { signal }),
    api.cms.modules.get({}, { signal }),
  ]);
  const details = h("details", { class: "-settings", open: true });
  const summary = h("summary", {}, await t`Settings`, h("output", {}, current.module));
  const title = h("input", { value: current.title === "-" ? "" : current.title });
  const module = h("select", {}, ...modules
    .filter(item => item.kind === (current.type === "p" ? "layout" : "cont"))
    .map(item => h("option", { value: item.name, selected: item.name === current.module }, item.name)));
  if (![...module.options].some(option => option.value === current.module)) {
    module.prepend(h("option", { value: current.module, selected: true }, current.module));
  }
  const name = h("input", { value: current.name || "" });
  const visible = h("input", { type: "checkbox", checked: Boolean(current.visible) });
  const icon = h("img", { src: new URL(`${current.module}/pub/module.svg`, new URL(ctx.moduleUrl, location.href)), alt: "" });
  icon.addEventListener("error", () => icon.src = new URL("../module.svg", import.meta.url), { once: true, signal });
  const intro = h("div", { class: "-intro" },
    h("div", {},
      h("strong", {}, `${current.type === "p" ? await t`Page` : await t`Content`} · ${current.id}`),
      h("span", {}, current.online ? await t`Online` : await t`Offline`),
    ),
    icon,
  );
  const general = h("div", { class: "-general" },
    h("label", {}, await t`Title`, title),
    h("label", {}, current.type === "p" ? await t`Layout` : await t`Module`, module),
    h("label", {}, await t`Identifier`, name),
    h("label", { class: "-check" }, visible, await t`Visible in navigation`),
  );
  const moduleSettings = h("div");
  details.append(summary, h("div", { class: "-body" }, intro, general, moduleSettings));
  el.replaceChildren(details);

  title.addEventListener("change", () => ref.title.put({ value: title.value }), { signal });
  name.addEventListener("change", () => ref.patch({ name: name.value }), { signal });
  visible.addEventListener("change", () => ref.patch({ visible: visible.checked }), { signal });
  module.addEventListener("change", async () => {
    module.disabled = true;
    try {
      await ref.module.put({ module: module.value });
      location.reload();
    } catch (error) {
      module.disabled = false;
      module.value = current.module;
      await dialogs.alert(error?.message || String(error));
    }
  }, { signal });

  const descriptor = await api["cms.frontend.3"].settings(current.id).get({}, { signal });
  if (!descriptor?.src) return generic(moduleSettings, current.id);

  const custom = cms.widget(descriptor.src, { node: current });
  custom.addEventListener("error", event => {
    event.preventDefault();
    generic(custom, current.id);
  }, { once: true, signal });
  moduleSettings.replaceWith(custom);
}
