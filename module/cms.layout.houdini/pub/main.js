import { cms } from '../../cms/pub/js/cms.mjs';

/* Native popovertarget exposes the open state to assistive technology, including light dismiss and Escape. */
export function init(el) {
  const menu = el.querySelector('#head-nav');
  if (!menu || typeof menu.hidePopover !== 'function') return;
  for (const type of ['focusin', 'pointerover']) menu.addEventListener(type, (event) => {
    const item = event.target.closest?.('nav > ul > li');
    if (item?.classList.contains('-dismissed') && !menu.matches(':popover-open') && !item.contains(event.relatedTarget))
      item.classList.remove('-dismissed');
  });
  menu.addEventListener('click', (event) => {
    const link = event.target.closest?.('a[href]');
    if (link && menu.matches(':popover-open')) menu.hidePopover();
  });
  // CSS decides when navigation returns to the header; an open popover must leave the top layer then.
  const opener = el.querySelector('[popovertarget="head-nav"]:not([popovertargetaction="hide"])');
  if (opener) {
    const observer = new ResizeObserver(() => {
      if (!el.isConnected) return observer.disconnect();
      if (!opener.getClientRects().length && menu.matches(':popover-open')) menu.hidePopover();
    });
    observer.observe(opener);
  }
}

// One document listener also dismisses hover menus when keyboard focus is elsewhere in the page.
if (typeof HTMLElement.prototype.hidePopover === 'function') document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  for (const item of document.querySelectorAll('#container.houdini #head-nav:not(:popover-open) nav > ul > li:is(:hover, :focus-within)')) {
    if (!item.querySelector(':scope > ul')?.getClientRects().length) continue;
    if (item.contains(document.activeElement)) item.querySelector(':scope > a')?.focus();
    item.classList.add('-dismissed');
  }
});

cms.initNode('layout.houdini', init);
