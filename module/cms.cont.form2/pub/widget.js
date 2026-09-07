/* Panel widget: where a sent form goes, and the mails it writes. */
import { html } from '@qino/pub/html.js';
import { api } from '@qino/pub/api.js';
import { t } from '@qino/pub/t.js';

import { bindSettings } from '../../cms/pub/js/settings.js';

export const css = `
.-form2 td { padding:.3em .6em .3em 0; vertical-align:top; }
.-form2 .-input { min-height:1.9em; padding:.4em; border:1px solid var(--cms-dark); outline:none; }
.-form2 .-input:focus { border-color:var(--cms-color); }
.-form2 label { display:block; }
`;

/** A text field of the node, rendered in place. Both come from render(), so both exist. */
const field = (texts, name) => texts[name] ?? { id: '', value: '' };

export default async function (widget, { node, signal }) {
  const ref = api.cms.node(node.id);
  const [settings, texts, contents] = await Promise.all([
    ref.settings.get({}, { signal }),
    ref.texts.get({ values: true }, { signal }),
    ref.contents.get({}, { signal }),
  ]);
  // the success content is created with the node; without it the row stays empty
  const success = contents.find((c) => c.name === 'success');
  const successHtml = success ? await api.cms.node(success.id).html.get({}, { signal }) : '';

  const subject = field(texts, 'mailSubject');
  const before = field(texts, 'email_before');
  const after = field(texts, 'email_after');

  await widget.html`<table class="-form2 u2-table -Fields -Flex -NoSideGaps">
    <tr>
      <td>${t`On success go to page`}
      <td><input type=number min=1 setting=redirect value="${settings.redirect ?? ''}">
    <tr>
      <td>${t`…or show this content`}
      <td>${html.raw(successHtml)}
    <tr>
      <td>${t`Recipients`}
      <td><textarea rows=2 setting=recipients>${settings.recipients ?? ''}</textarea>
    <tr>
      <td>${t`Subject`}<br><small>${t`(the page title is used when empty)`}</small>
      <td><input cmstxt="${subject.id}" value="${subject.value}">
    <tr>
      <td>${t`E-Mail above`}
      <td><div class=-input contenteditable cmstxt="${before.id}">${html.raw(before.value)}</div>
    <tr>
      <td>${t`E-Mail below`}
      <td><div class=-input contenteditable cmstxt="${after.id}">${html.raw(after.value)}</div>
    <tr>
      <td>${t`Buttons`}
      <td>
        <label><input type=checkbox setting=button ${settings.button ?? true ? 'checked' : ''}> ${t`Submit`}</label>
        <label><input type=checkbox setting=reset ${settings.reset ? 'checked' : ''}> ${t`Reset`}</label>
  </table>`;

  bindSettings(widget, ref);
}
