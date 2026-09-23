/* The panel's files widget in the page content. Edit mode only (it uses the admin api). */
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
