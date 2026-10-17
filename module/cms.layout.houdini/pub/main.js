import { cms } from '../../cms/pub/js/cms.mjs';

/* Keep the open state truthful for assistive technology, including light dismiss and Escape. */
export function init(el) {
  const languages = el.querySelector('.-languages');
  const label = languages?.querySelector('.-label');
  if (label?.id) {
    const name = () => {
      for (const select of languages.querySelectorAll('select:not([aria-label], [aria-labelledby])'))
        select.setAttribute('aria-labelledby', label.id);
    };
    name();
    new MutationObserver(name).observe(languages, { childList: true, subtree: true });
  }
  const menu = el.querySelector('#head-nav');
  if (!menu || typeof menu.hidePopover !== 'function') return;
  const triggers = el.querySelectorAll('[popovertarget="head-nav"]');
  const sync = () => {
    for (const button of triggers) button.setAttribute('aria-expanded', String(menu.matches(':popover-open')));
  };
  menu.addEventListener('toggle', sync);
  sync();
  menu.addEventListener('click', (event) => {
    const link = event.target.closest?.('a[href]');
    if (link && menu.matches(':popover-open')) menu.hidePopover();
  });
  // CSS decides when navigation returns to the header; an open popover must leave the top layer then.
  const opener = [...triggers].find((button) => button.getAttribute('popovertargetaction') !== 'hide');
  if (opener) {
    const observer = new ResizeObserver(() => {
      if (!el.isConnected) return observer.disconnect();
      if (!opener.getClientRects().length && menu.matches(':popover-open')) menu.hidePopover();
    });
    observer.observe(opener);
  }
}

cms.initNode('layout.houdini', init);
