/* Only loaded for someone who may release: the checkbox on an entry, saved where it is. */
import { api } from '@qino/pub/api.js';

document.addEventListener('change', (e) => {
  const box = e.target.closest?.('[qcms-mod="cont.form4.entries"] [data-release]');
  if (!box) return;
  const block = box.closest('[qcms-id]');
  api.cms.node(block.getAttribute('qcms-id')).api.post({ release: box.dataset.release, on: box.checked });
  box.closest('.-entry')?.classList.toggle('-pending', !box.checked);
});
