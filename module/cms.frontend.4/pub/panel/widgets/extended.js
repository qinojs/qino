/* Advanced node settings: navigation flags, identifier, base node, subpage definition. */
import { html } from '@qino/pub/html.js';
import { api, t } from '@qino/pub/qino.js';

const MODELS = ['cms', 'models'];

export const css = `
.-advanced label { display:block; margin-bottom:.8em; }
.-advanced table { margin-bottom:.8em; }
.-advanced .-name, .-advanced .-basis { width:15rem; }
.-advanced .-childXML { display:block; width:100%; height:7.5rem; }
`;

export default async function (el, { node, superuser, signal }) {
  const ref = api.cms.node(node.id);
  const [vs, settings, models] = await Promise.all([
    ref.get({}, { signal }),
    ref.settings.get({}, { signal }),
    // the model list is an app setting: superusers only, and nobody else may write it
    superuser ? api.core.settings(MODELS).get({}, { signal }) : null,
  ]);
  const modelIds = String(models ?? '').split(',').map((v) => v.trim()).filter(Boolean);

  el.head = t`Advanced`;

  await el.html`<div class=-advanced>
    <label><input class=-visible type=checkbox ${vs.visible ? 'checked' : ''}> ${t`Visible in navigation`}</label>
    <label><input class=-searchable type=checkbox ${vs.searchable ? 'checked' : ''}> ${t`Searchable`}</label>
    ${superuser
      ? html.async`<label><input class=-model type=checkbox ${modelIds.includes(String(node.id)) ? 'checked' : ''}> ${t`Show as template under "Modules"`}</label>`
      : ''}
    <table><tbody style="vertical-align:middle">
      <tr>
        <td>${t`Identifier`} (${t`Layout position`}):
        <td><input class=-name value="${vs.name}">
      <tr>
        <td>${t`Base`}:
        <td><input class=-basis type=qgcms-page value="${vs.basis}">
    </table>
    ${t`Subpage definition`}
    <textarea class=-childXML rows=4>${settings?.childXML}</textarea>
  </div>`;

  // Nested widgets: the panel frames the widgets it mounts, this one frames the two it mounts.
  // Same markup, so the panel's delegated click handler opens and closes them like any other.
  for (const [name, title] of [['sets', await t`Settings`], ['txts', await t`Texts`]]) {
    const open = cms.panel.widgets.has(name)?.get({ silent: true });
    el.insertAdjacentHTML('beforeend', `<div class="-widgetHead ${open ? '-open' : ''}"><span class=-title>${title}</span></div>`);
    const child = el.widget(new URL(`./${name}.js`, import.meta.url), { node });
    child.className = '-content';
    child.setAttribute('widget', name); // the click handler remembers the open state under this name
    el.append(child);
  }

  el.on('change', '.-visible', (inp) => ref.patch({ visible: inp.checked }));
  el.on('change', '.-searchable', (inp) => ref.patch({ searchable: inp.checked }));
  el.on('change', '.-name', (inp) => ref.patch({ name: inp.value }));
  el.on('change', '.-childXML', (inp) => ref.settings.childXML.put({ value: inp.value }));
  // "base" is the parent: moving there is the edit. The picker fills the field without firing
  // change, so focusout — but only on a real change, an unchanged value would reorder the siblings.
  el.on('focusout', '.-basis', (inp) => {
    if (!inp.value || inp.value === String(vs.basis)) return;
    api.cms.node(inp.value)['insert-before'].put({ id: String(node.id) }).then(() => el.reload());
  });
  el.on('change', '.-model', (inp) => {
    const next = modelIds.filter((id) => id !== String(node.id));
    if (inp.checked) next.push(String(node.id));
    api.core.settings(MODELS).put({ value: next.join(',') }).then(() => el.reload());
  });
}
