import { api } from '@qino/pub/api.js';
import { html } from '@qino/pub/html.js';
import { t } from '@qino/pub/t.js';
import { shortName } from '../panel/widgets/modules.js';

import { dialog } from './inline.js';

/** Offer the cut content for pasting on this page. */
export default function (pid) {
  const els = () => document.querySelectorAll('[qcms-id="'+pid+'"]');
  function close() {
    api.cms.clipboard.put({ value: 0 });
    els().forEach(el => el.style.opacity = 1);
  }
  els().forEach(el => el.style.opacity = 0.4);
  api.cms.node(pid).get().then(async res => {
    dialog(
      await t`Paste from clipboard`,
      await html.async`<table>
        <tr><th> ${t`Title`}: &nbsp;<td> ${res.title}
        <tr><th> ${t`Module`}: &nbsp;<td> ${res.module ? shortName(res.module) : ''}
        <tr><th> Id: &nbsp;<td> ${pid}
      </table>`,
      [{
        title: t`Paste on this page`, then() {
          cms.cont(pid).addPosition();
          els().forEach(el => el.remove());
          close();
        }
      },{ title: t`Keep in place`, then: close 
      },{ title: t`Close` }]
    );
  });
};
