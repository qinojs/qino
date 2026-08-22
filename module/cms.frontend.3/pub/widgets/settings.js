import { api, cms, h, t } from "../cms.js";

export const css = `
qino-cms .-settings > summary { display:flex; gap:.5rem; align-items:center; }
qino-cms .-settings > summary output { margin-left:auto; }
qino-cms .-settings .-general { display:grid; gap:.5rem; margin-block:.75rem; }
qino-cms .-settings label { display:grid; gap:.2rem; }
`;

const generic = async (target, id) => {
  await import("@qino/pub/SettingsEditor.mjs");
  target.replaceWith(h("settings-editor", { source: `cms/node/${id}/settings` }));
};

export default async function (el, { node, signal }) {
  const current = await api.cms.node(node.id).get({}, { signal });
  const details = h("details", { class: "-settings", open: true });
  const summary = h("summary", {}, await t`Settings`, h("output", {}, current.module));
  const title = h("input", { value: current.title === "-" ? "" : current.title });
  const general = h("div", { class: "-general" },
    h("label", {}, await t`Title`, title),
    h("label", {}, await t`Module`, h("code", {}, current.module)),
  );
  const moduleSettings = h("div");
  details.append(summary, h("div", { class: "-body" }, general, moduleSettings));
  el.replaceChildren(details);

  title.addEventListener("change", () => api.cms.node(current.id).title.put({ value: title.value }), { signal });

  const descriptor = await api["cms.frontend.3"].settings(current.id).get({}, { signal });
  if (!descriptor?.src) return generic(moduleSettings, current.id);

  const custom = cms.widget(descriptor.src, { node: current });
  custom.addEventListener("error", event => {
    event.preventDefault();
    generic(custom, current.id);
  }, { once: true, signal });
  moduleSettings.replaceWith(custom);
}
