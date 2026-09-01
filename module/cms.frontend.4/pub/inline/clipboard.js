import { api } from '@qino/pub/api.js';
import { html } from '@qino/pub/html.js';

import { dialog } from './inline.js';

/** Offer the cut content for pasting on this page. */
export default function (pid) {
  const els = () => document.querySelectorAll('[qcms-id="'+pid+'"]');
  function close() {
    api.cms.clipboard.put({ value: 0 });
    els().forEach(el => el.style.opacity = 1);
  }
  els().forEach(el => el.style.opacity = 0.4);
  api.cms.node(pid).get().then(res => {
    dialog(
      'Paste from clipboard',
      html`<table>
        <tr><th> Title: &nbsp;<td> ${res.title}
        <tr><th> Module: &nbsp;<td> ${res.module}
        <tr><th> Id: &nbsp;<td> ${pid}
      </table>`,
      [{
        title: 'Paste on this page', then() {
          cms.cont(pid).addPosition();
          els().forEach(el => el.remove());
          close();
        }
      },{ title: 'Keep in place', then: close 
      },{ title: 'Close' }]
    );
  });
};
