/* What the panel adds to inline's menus on the page. Inline itself knows nothing about settings. */
import { t } from '@qino/pub/t.js';
import { ctx } from '@qino/pub/qino.js';

import { blockMenu, blockSelector } from '../inline/contextMenu.js';
import { contMenuButtons } from '../inline/inline.js';

/** Select a content and open its settings in the sidebar. */
export function showSettings(pid) {
  cms.cont.active = pid;
  cms.panel.sidebar.set('settings');
}

blockMenu.addItem(t`Settings`, {
  icon: ctx.moduleUrl + 'cms.frontend.2/pub/img/settings.svg',
  selector: blockSelector,
  onshow() {
    this.activePid = cms.contPos.active.pid;
    this.disabled = !cms.contPos.active.el.hasAttribute('qcms-edit');
  },
  onclick() { showSettings(this.activePid); },
});

const gear = c1.dom.el(
  '<div class=-opts title=Settings>' +
  '  <svg width="24" height="24" viewBox="0 0 24 24"><path d="M19.14 12.94c.04-.3.06-.61.06-.94c0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.488.488 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6s3.6 1.62 3.6 3.6s-1.62 3.6-3.6 3.6z"></path></svg>' +
  '</div>');
gear.addEventListener('click', () => showSettings(cms.contPos.active.pid));
contMenuButtons.push({ el: gear, show: obj => obj.el.hasAttribute('qcms-edit') });
