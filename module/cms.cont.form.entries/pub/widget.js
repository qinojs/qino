/* Panel widget: the form whose entries this block shows, and how. Choosing a form enters the block
   with it (`listing_nodes`), a settings write on the form: only who may edit the form gets it
   through — everyone else is told so. Opening the panel writes nothing. */
import { html } from '@qino/pub/html.js';
import { api } from '@qino/pub/api.js';
import { t } from '@qino/pub/t.js';

import { bindSettings } from '../../cms/pub/js/settings.js';

export default async function (widget, { node, signal }) {
  const ref = api.cms.node(node.id);
  const settings = await ref.settings.get({}, { signal });
  const value = (v) => v ?? '';

  await widget.html`<table class="u2-table -Fields -Flex -NoSideGaps">
    <tr>
      <td>${t`Form`}
      <td><input class=-form type=qgcms-page value="${value(settings.form)}" placeholder="${t`the first form on this page`}">
        <div class=-denied></div>
    <tr>
      <td>${t`Show fields`}
      <td><input setting=show_fields value="${value(settings.show_fields)}" placeholder="${t`all, in the form's order`}">
    <tr>
      <td>${t`Only if this field is set`}
      <td><input setting=only_if value="${value(settings.only_if)}">
    <tr>
      <td>${t`Entries`}
      <td><input type=number min=1 setting=limit value="${value(settings.limit)}" placeholder=20>
    <tr>
      <td>${t`Hide spam from`}
      <td><input type=number min=0 max=1 step=0.05 setting=spam_threshold value="${value(settings.spam_threshold)}" placeholder=0.5>
    <tr>
      <td>${t`Moderated`}
      <td><label><input type=checkbox setting=moderated ${settings.moderated ? 'checked' : ''}> ${t`Show an entry once it was released`}</label>
  </table>`;

  bindSettings(widget, ref);

  /* A form is chosen by entering this block with it first (only who may edit the form gets that
     through), then saving it here. Without the right, say so and keep the old one. The picker sets
     the value without a change event, so this runs when the field is left. */
  const denied = widget.querySelector('.-denied');
  /** Enter this block with `candidate` (or the form it shows), unless it is already; false with a
   *  message when it is no form or may not be edited. */
  const allow = async (candidate) => {
    const { form, allowed } = await ref.api.post({ status: candidate || true });
    const ok = !form ? !candidate : allowed ||
      await api.cms.node(form).settings.listing_nodes[node.id].put({ value: true }).then(() => true, () => false);
    denied.textContent = ok ? '' : !form ? t`This is not a form.` : t`You may not edit this form, so its entries cannot be shown here.`;
    return ok;
  };

  let form = value(settings.form);
  widget.on('focusout', '.-form', async (inp) => {
    if (inp.value === form) return;
    if (inp.value && !await allow(inp.value)) return inp.value = form;
    form = inp.value;
    await ref.settings.form.put({ value: form });
    if (!form) await allow(); // none chosen: the first form on the page, known once saved
    cms.reloadNode(node.id);
  });
}
