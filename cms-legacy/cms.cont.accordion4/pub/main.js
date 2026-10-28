// A linked item (`#cmspid<id>`) opens, on load and as the hash changes; a click into a title being
// edited does not toggle its item.
const ITEM = '[qcms-mod="cont.accordion4"] > details';

const openLinked = () => {
  const target = location.hash ? document.getElementById(decodeURIComponent(location.hash.slice(1))) : null;
  if (target?.matches(ITEM)) target.open = true;
};
openLinked();
addEventListener('hashchange', openLinked);

document.addEventListener('click', (e) => e.target.closest?.(`${ITEM} > summary [contenteditable]`) && e.preventDefault());
