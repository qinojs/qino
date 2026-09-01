/* The page tree with its legend. The tree engine itself lives in tree.js; this mounts it. */
import { api } from '@qino/pub/api.js';
import { t } from '@qino/pub/t.js';

export default async function (widget, { node, dialogs, signal }) {
  const showContents = !!cms.panel.state.has('tree_show_c')?.get({ silent: true });
  const [data, vs] = await Promise.all([
    // open the branch down to what the panel is on — a content block, not just its page
    api.cms.tree.get({ filter: showContents ? '*' : 'p', expandTo: node.id }, { signal }),
    api.cms.node(node.id).get({}, { signal }),
  ]);

  widget.head = t`Structure`;

  await widget.html`<div class="-standalone" style="flex:1; margin-bottom:2em">
    <div class=-h1>
      <span>${t`Structure`}</span>
      <input id=page-add type=text style="width:50%"
             placeholder="${t`New subpage of "${vs.title}"`} "
             title="${t`The new page will be created as a subpage of the selected page. Press Enter to create the page`}">
    </div>
    <div id=tree></div>
  </div>
  <div class=-standalone>
    <div class=-h1>${t`Legend`}</div>
    <table class=-padding style="line-height:1">
      <tr><td><span class=-access-0 style="font-size:1.7em">&#x2B24;</span><td>${t`No permission`}
      <tr><td><span class=-access-1 style="font-size:1.7em">&#x2B24;</span><td>${t`View page`}
      <tr><td><span class=-access-2 style="font-size:1.7em">&#x2B24;</span><td>${t`Edit page`}
      <tr><td><span class=-access-3 style="font-size:1.7em">&#x2B24;</span><td>${t`Edit page and manage permissions`}
      <tr><td style="padding-left:.125rem"><span style="font-family:'qg_cms';font-size:1.7em">&#xe900;</span><td>${t`The page is not publicly accessible`}
      <tr><td style="padding-left:.125rem"><span style="font-family:'qg_cms';font-size:1.7em">&#xe901;</span><td>${t`The page is scheduled and currently not online`}
    </table>
  </div>`;

  await import('../tree.js');
  await cmsTreeInit(data);

  const inp = widget.querySelector('#page-add');
  const add = () => {
    const title = inp.value.trim();
    title && cms.Tree.addPage(title);
    inp.value = '';
  };
  widget.on('focusout', '#page-add', async (i) => {
    if (i.value && await dialogs.confirm(t`Create page "${i.value}"?`)) add();
  });
  widget.on('keydown', '#page-add', (i, e) => {
    if (e.key === 'Enter') add();
    if (e.key === 'Escape') { i.value = ''; i.blur(); }
  });
  // the new page becomes a child of whatever is selected, so the placeholder follows the selection
  cms.Tree.onActivate = (n) => inp.placeholder = inp.placeholder.replace(/"([^"]*)"/, `"${n.data.title}"`);
}
