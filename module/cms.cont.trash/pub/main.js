import { apt } from "../../core/pub/js/qino.js";

const el      = document.querySelector('[qcms-mod="cont.trash"]');

const dialog = el.querySelector('.-preview');
const iframe = dialog.querySelector('iframe');

dialog.addEventListener('click', e => { if (e.target === dialog) dialog.close(); });
iframe.addEventListener('load', () => {
  try {
    iframe.contentDocument.addEventListener('keydown', e => { if (e.key === 'Escape') dialog.close(); });
  } catch { /* cross-origin */ }
});

el.querySelector('.-list').addEventListener('click', async e => {
  const item = e.target.closest('.-item');
  if (!item) return;
  const id = Number(item.dataset.id);
  if (e.target.closest('.-remove')) {
    item.style.opacity = '.4';
    await apt.cms.node(id).delete();
    item.remove();
  } else if (e.target.closest('.-restore')) {
    item.style.opacity = '.4';
    const { url } = await apt.cms.node(id).restore.post();
    location.href = url;
  } else {
    iframe.src = item.dataset.url;
    dialog.showModal();
  }
});

el.querySelector('.-removeAll')?.addEventListener('click', async function () {
  this.disabled = true;
  for (const item of el.querySelectorAll('.-item')) {
    item.style.opacity = '.4';
    await apt.cms.node(Number(item.dataset.id)).delete();
    item.remove();
  }
});
