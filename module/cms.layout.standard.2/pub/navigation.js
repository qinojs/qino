// Visible links first, native popover enhancement second.
import { SelectorObserver } from '@qino/u2/js/SelectorObserver/SelectorObserver.js';

function enhance(head) {
  const panel = head.querySelector('#head-nav');
  const open = head.querySelector('.-open');
  const close = panel?.querySelector('.-close');

  if (!panel || !open || !close || !('showPopover' in panel)) return;
  const controller = new AbortController();
  const { signal } = controller;
  const narrow = matchMedia('(width < 48rem)');
  function update() {
    const active = document.activeElement;
    const hadFocus = head.contains(active);
    if (panel.matches(':popover-open')) panel.hidePopover();
    if (narrow.matches) panel.setAttribute('popover', 'auto');
    else panel.removeAttribute('popover');
    head.classList.toggle('-compact', narrow.matches);
    open.hidden = close.hidden = !narrow.matches;
    if (hadFocus && narrow.matches && panel.contains(active)) open.focus();
    if (hadFocus && !narrow.matches && (active === open || active === close))
      (panel.querySelector('a[href]') ?? head.querySelector('a[href]'))?.focus();
  }
  narrow.addEventListener('change', update, { signal });
  panel.addEventListener('click', (event) => {
    if (!(event.target instanceof Element)) return;
    const link = event.target.closest('a[href]');
    if (!link || event.defaultPrevented || event.button || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    // Leave editor selection and links opened in another context alone.
    if (head.closest('[qcms-edit]') || link.hasAttribute('cmstxt')) return;
    if (link.target && link.target !== '_self' || link.hasAttribute('download')) return;
    if (panel.matches(':popover-open')) panel.hidePopover();
  }, { signal });
  update();
  return () => {
    controller.abort();
    if (panel.matches(':popover-open')) panel.hidePopover();
    panel.removeAttribute('popover');
    head.classList.remove('-compact');
    open.hidden = close.hidden = true;
  };
}

// The editor can replace the layout without loading its module script again.
{
  const cleanups = new WeakMap();
  new SelectorObserver({
    on: head => cleanups.set(head, enhance(head)),
    off: head => { cleanups.get(head)?.(); cleanups.delete(head); },
  }).observe('#container > #head');
}

