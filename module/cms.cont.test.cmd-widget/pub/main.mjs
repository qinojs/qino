/* The panel's files widget, mounted into this block's page content. Only in edit mode: the
  * widget talks to the admin api and belongs to whoever may edit the node. */
import { ctx } from '@qino/pub/qino.js';

if (globalThis.qino?.cms?.editmode) {
  const [{ widget }, { SelectorObserver }] = await Promise.all([
    import(ctx.moduleUrl + 'cms.frontend.4/pub/panel/widget.js'),
    import('@qino/u2/js/SelectorObserver/SelectorObserver.js'),
  ]);
  const src = ctx.moduleUrl + 'cms.frontend.4/pub/panel/widgets/media.js';
  new SelectorObserver({
    on: (el) => el.append(widget(src, { node: { id: cms.el.nid(el) }, dialogs: cms.panelRoot })),
  }).observe('[qcms-mod="cont.test.cmd-widget"] .-files');
}
