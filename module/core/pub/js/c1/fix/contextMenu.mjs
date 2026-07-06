document.addEventListener('DOMContentLoaded', () => {
  if (document.body.contextMenu !== undefined) return;

  const el    = html => c1.dom.fragment(html).firstChild;
  const stop  = e => e.stopPropagation();
  const show  = node => node.matches(':popover-open') || node.showPopover();
  const close = (active = null) => {
    for (const ul of [...poly.querySelectorAll('ul:popover-open')].reverse().concat(poly))
      if (!ul.contains(active)) ul.hidePopover();
  };

  const poly = el('<ul id=contextMenuePolyfill popover=manual tabindex=0>');
  document.body.append(poly);
  poly.addEventListener('focusout', e => close(e.relatedTarget));
  poly.addEventListener('keydown', e => { // todo
    if (['ArrowUp', 'ArrowDown', 'ArrowRight', 'Enter'].includes(e.key)) e.preventDefault();
  });

  document.documentElement.addEventListener('contextmenu', e => {
    if (e.shiftKey) return;
    const menu = document.getElementById(e.target.closest('[contextmenu]')?.getAttribute('contextmenu'));
    if (!menu?.children.length) return;
    e.preventDefault();
    parse(menu, poly);
    show(poly);
    poly.style.top  = Math.min(innerHeight - poly.offsetHeight, e.clientY) + 'px';
    poly.style.left = Math.min(innerWidth  - poly.offsetWidth,  e.clientX) + 'px';
    poly.focus();
  });

  let openTimeout;
  const open = li => {
    clearTimeout(openTimeout);
    const sub = li.querySelector(':scope > ul');
    if (!sub) return;
    show(sub);
    sub.c1Placer.follow(li);
    sub.focus();
    return true;
  };

  function parse(menu, list) {
    list.replaceChildren();
    for (const item of menu.children) {
      const li = el(`<li>${item.getAttribute('label') ?? ''}`);
      const icon = item.getAttribute('icon');
      if (icon) li.style.backgroundImage = `url(${icon})`;
      const disabled = item.hasAttribute('disabled') || item.disabled; // todo: check value of attribute
      if (disabled) li.classList.add('-disabled'), li.disabled = true;
      li.addEventListener('mouseenter', () => { clearTimeout(openTimeout); openTimeout = setTimeout(() => open(li), 250); });
      li.addEventListener('click', e => {
        if (e.target !== li) return;
        stop(e);
        if (open(li) || disabled) return;
        item.dispatchEvent(new Event('click'));
        close();
      });
      li.addEventListener('mousedown', stop);
      li.addEventListener('touchstart', stop);
      list.append(li);
      if (item.children.length) {
        li.classList.add('-sub');
        const sub = el('<ul popover=manual tabindex=0>');
        sub.c1Placer = new c1.Placer(sub, { x: 'after', y: 'prepend', margin: { top: 1, right: -3, bottom: 1, left: -3 } });
        li.append(sub);
        parse(item, sub);
      }
    }
    if (list === poly) list.append(el('<li style="font-size:12px; padding:5px" class=-disabled>shift + rightclick to show the<br> native menu'));
  }

  const arrow = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="32" fill="none" viewBox="0 0 16 32"><path stroke="#000" stroke-width="2" d="M2 2l12 12L2 26" stroke-linecap="round"/></svg>';
  const css = `
    menu[type=context] { display:none }
    #contextMenuePolyfill {
      &, & ul {
        position:fixed; inset:auto; overflow:visible;
        background:#fff; box-shadow:0 0 8px rgba(0,0,0,.3);
        list-style:none; font-family:Arial; font-size:15px;
        margin:0; padding:0; min-width:100px; color:#000;
        cursor:default; border:1px solid #aaa;
      }
      &:focus { outline:none }
      & li {
        display:flex; padding:6px 10px 6px 30px;
        background-position:6px 50%; background-repeat:no-repeat; background-size:16px 16px;
        &:hover, &:focus-within { background-color:#f3f3f3 }
        &.-disabled { opacity:.36 }
        &.-sub:after {
          content:""; flex:1 0 10px;
          background:url("data:image/svg+xml;utf8,${encodeURIComponent(arrow)}") no-repeat 100% 50%;
          background-size:contain; height:.9em; margin:auto;
        }
      }
    }`;
  document.head.prepend(el(`<style>${css}</style>`));
});
