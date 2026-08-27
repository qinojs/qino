/* Settings widget of the test block. The files widget it shows sits in the page content,
  * mounted by pub/main.mjs. */
import { api, t } from '@qino/pub/qino.js';

export default async function (el, { node, signal }) {
  const ref = api.cms.node(node.id);
  const settings = await ref.settings.get({}, { signal });

  el.head = t`Test block`;

  await el.html`<label>${t`Note`}: <input setting=note value="${settings?.note ?? ''}"></label>`;
  el.on('input', '[setting]', (inp) => ref.settings.note.put({ value: inp.value }));
}
