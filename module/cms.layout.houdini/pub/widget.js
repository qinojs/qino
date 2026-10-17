import { html } from '@qino/pub/html.js';
import { api } from '@qino/pub/api.js';
import { t } from '@qino/pub/t.js';

import { DESIGN_MARKER, FIELDS, safeValue, themeCss } from './theme.js';

export const css = `
  .-houdiniEditor label, .-houdiniEditor .-field { display: grid; gap: .25em; margin-block: .75em; }
  .-houdiniEditor .-field > label { margin: 0; }
  .-houdiniEditor input { inline-size: 100%; min-inline-size: 0; }
  .-houdiniEditor .-value { display: flex; align-items: center; gap: .5em; }
  .-houdiniEditor input[type=color] { inline-size: 3em; block-size: 2.75em; flex: none; padding: .2em; }
  .-houdiniEditor .-files a { display: block; }
  .-houdiniEditor .-actions { display: flex; flex-wrap: wrap; gap: .75em; }
  .-houdiniEditor .-swatch { display: inline-block; inline-size: 1em; block-size: 1em; border: 1px solid currentColor; vertical-align: middle; }
`;

export default async function (widget, { node, signal }) {
  const ref = api.cms.node(node.id);
  const layout = await ref.api.post({ do: 'getLayout' }, { signal });
  if (!layout) return;
  widget.head = 'Houdini';
  const invalid = await t`Enter a valid CSS value.`;
  const groups = [...new Set(FIELDS.map((field) => field.group))];
  const fontList = `houdini-fonts-${node.id}`;
  const schemeList = `houdini-schemes-${node.id}`;
  const root = getComputedStyle(document.documentElement);
  const fonts = [...new Set([
    root.getPropertyValue('--font-1').trim(), root.getPropertyValue('--font-2').trim(),
    'system-ui, sans-serif', 'ui-serif, serif', 'Georgia, serif', 'ui-monospace, monospace',
  ].filter(Boolean))];

  await widget.html`<div class=-houdiniEditor>
    <p>${t`Design settings apply to every page using this layout. Empty fields use the defaults. Site CSS has the final say.`}</p>
    <form class=-design>
      <datalist id="${fontList}">${fonts.map((font) => html`<option value="${font}"></option>`)}</datalist>
      <datalist id="${schemeList}"><option value=light></option><option value=dark></option><option value="light dark"></option></datalist>
      ${groups.map((group) => html.async`<details>
        <summary>${t([group])}</summary>
        ${FIELDS.filter((field) => field.group === group).map((field) => html.async`<div class=-field>
          <label for="houdini-${node.id}-${field.key}"><span>${t([field.label])} ${field.property === 'color' ? html`<span class=-swatch data-swatch="${field.key}" aria-hidden=true></span>` : ''}</span></label>
          <span class=-value>
            <input id="houdini-${node.id}-${field.key}" name="${field.key}" value="${safeValue(layout.design?.[field.key])}" placeholder="${field.hint}" list="${field.property === 'font-family' ? fontList : field.property === 'color-scheme' ? schemeList : ''}" spellcheck=false autocomplete=off>
            ${field.property === 'color' ? html.async`<input type=color data-color="${field.key}" aria-label="${t([field.label])}">` : ''}
          </span>
        </div>`)}
      </details>`)}
      <p class=-actions>
        <button type=submit>${t`Save design`}</button>
        <button type=reset>${t`Discard changes`}</button>
        <button type=button class=-defaults>${t`Use defaults`}</button>
      </p>
      <output aria-live=polite></output>
    </form>
    <details>
      <summary>${t`Template and CSS`}</summary>
      <p>${t`These files are shared by all pages using Houdini. Their contents are fully editable.`}</p>
      <div class=-files>${layout.files.map((file) => html`<a data-key="${file.key}" target=_blank rel=noopener href="${file.url}">${file.name}</a>`)}</div>
    </details>
    <details>
      <summary>${t`u2 release`}</summary>
      <form class=-version>
        <label>u2<input name=version value="${layout.u2Version}" placeholder="${layout.u2Default}" pattern="\\d+\\.\\d+\\.\\d+" autocomplete=off></label>
        <p>${t`Update after checking your template and CSS against the new release.`}</p>
        <button type=submit>${t`Save release`}</button>
        <output aria-live=polite></output>
      </form>
    </details>
  </div>`;

  // Edit the server-built sheet through CSSOM: its cascade position and CSP authorization stay intact.
  const current = document.querySelector(`[qcms-mod="${CSS.escape(layout.module.replace(/^cms\./, ''))}"]`);
  const sheet = current && [...document.head.querySelectorAll('style')].find((style) => style.textContent.trim().startsWith(DESIGN_MARKER))?.sheet;
  const original = sheet ? [...sheet.cssRules].map((rule) => rule.cssText) : [];
  const replace = (rules) => {
    if (!sheet) return;
    while (sheet.cssRules.length) sheet.deleteRule(0);
    for (const rule of rules) sheet.insertRule(rule, sheet.cssRules.length);
  };
  replace([]);
  const form = widget.querySelector('.-design');
  if (!sheet) form.querySelector('output').textContent = String(await t`Open a page using this layout to preview your changes.`);
  const inherited = getComputedStyle(document.documentElement);
  for (const field of FIELDS)
    form.elements.namedItem(field.key).placeholder = inherited.getPropertyValue(`--${field.key}`).trim() || field.hint;
  const palette = document.createElement('canvas');
  palette.width = palette.height = 1;
  const context = palette.getContext('2d');
  const probe = document.createElement('span');
  probe.hidden = true;
  probe.setAttribute('aria-hidden', 'true');
  (current ?? document.body).append(probe);
  const values = () => Object.fromEntries([...new FormData(form)].map(([key, value]) => [key, value.trim()]).filter(([, value]) => value));
  const paint = () => {
    const design = values();
    for (const field of FIELDS) {
      const input = form.elements.namedItem(field.key);
      const value = input.value.trim();
      const valid = !value || safeValue(value) && CSS.supports(field.property, value);
      input.setCustomValidity(valid ? '' : String(invalid));
      if (!valid) design[field.key] = safeValue(layout.design?.[field.key]);
    }
    replace([themeCss(design)]);
    // Resolve colors in the page, not in the CMS shadow root with its own palette.
    for (const field of FIELDS.filter((field) => field.property === 'color')) {
      const input = form.elements.namedItem(field.key);
      probe.style.backgroundColor = input.validity.valid && input.value.trim()
        ? input.value : `var(--${field.key}, ${field.hint})`;
      const color = getComputedStyle(probe).backgroundColor;
      form.querySelector(`[data-swatch="${field.key}"]`).style.backgroundColor = color;
      const picker = form.querySelector(`[data-color="${field.key}"]`);
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
      picker.value = '#' + [...context.getImageData(0, 0, 1, 1).data].slice(0, 3).map((value) => value.toString(16).padStart(2, '0')).join('');
    }
  };
  paint();
  const scheme = matchMedia('(prefers-color-scheme: dark)');
  scheme.addEventListener('change', paint, { signal });
  widget.on('input', '.-design input[name]', paint);
  widget.on('input', '[data-color]', (picker) => {
    form.elements.namedItem(picker.dataset.color).value = picker.value;
    paint();
  });
  widget.on('reset', '.-design', () => queueMicrotask(paint));
  widget.on('click', '.-defaults', () => {
    for (const field of FIELDS) form.elements.namedItem(field.key).value = '';
    paint();
  });

  const save = async (form, write) => {
    const button = form.querySelector('[type=submit]');
    const output = form.querySelector('output');
    button.disabled = true;
    try {
      await write();
      location.reload();
    } catch (error) {
      output.textContent = error.message;
      button.disabled = false;
    }
  };
  widget.on('submit', '.-design', (form, event) => {
    event.preventDefault();
    save(form, () => api.cms.node(layout.id).settings.design.put({ value: values() }, { signal }));
  });
  widget.on('submit', '.-version', (form, event) => {
    event.preventDefault();
    save(form, () => api.cms.node(layout.id).settings.u2Version.put({ value: form.elements.version.value.trim() }, { signal }));
  });
  widget.on('click', '.-files a', async (link, event) => {
    event.preventDefault();
    const tab = globalThis.open('about:blank', '_blank');
    if (tab) tab.opener = null;
    try {
      await ref.api.post({ do: 'openFile', key: link.dataset.key }, { signal });
      if (tab) tab.location.href = link.href;
    } catch (error) {
      tab?.close();
      throw error;
    }
  });
  return () => {
    scheme.removeEventListener('change', paint);
    replace(original);
    probe.remove();
  };
}
