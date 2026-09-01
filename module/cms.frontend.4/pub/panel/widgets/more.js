/* The panel's "more" sidebar: who is logged in, feedback, password, cms settings. */
import { html } from '@qino/pub/html.js';
import { api } from '@qino/pub/api.js';
import { t } from '@qino/pub/t.js';
import { ctx } from '@qino/pub/qino.js';

export const css = `
.-more .-feedbackform textarea { width:100%; height:12.5rem; }
.-more .-feedbackform button { width:100%; padding:.625rem 3.125rem; }
.-more .-pwchange table { width:13.4375rem; }
.-more .-pwchange input { width:100%; }
.-more .-thanks { color:#4c4; display:block; margin:.5em 0; }
`;

const setting = (path) => api.core['ctx-settings'](path);
const reload = () => location.href = location.href.replace(/#.*$/, '');

export default async function (widget, { dialogs, signal }) {
  const [me, langs, draft, lang, treeShowC] = await Promise.all([
    api['cms.frontend.4'].feedback.get({}, { signal }),
    api.core.languages.get({}, { signal }),
    setting(['cms', 'feedback', 'text']).get({}, { signal }).catch(() => ''),
    setting(['core', 'lang_ns', 'cms']).get({}, { signal }).catch(() => ''),
    setting(['cms.frontend.4', 'ui', 'tree_show_c']).get({}, { signal }).catch(() => false),
  ]);

  widget.head = t`More`;

  await widget.html`<div class=-more>
    <div class=-standalone>
      <div class=-h1>
        <span>${t`Logged in as:`} ${me.name}</span>
        <div>
          <button class=-tour>${t`Start CMS tour`}</button>
          <form method=post style="display:inline">
            <input type=hidden name=csrfToken value="${ctx.csrfToken}">
            <button name=core_logout>${t`log out`}</button>
          </form>
        </div>
      </div>
    </div>
    <div class="-widgetHead -open"><span class=-title>${t`Feedback / Support`}</span></div>
    <div>
      <form class=-feedbackform>
        <textarea name=msg required placeholder="${t`Message to:`} ${me.email}">${draft}</textarea>
        <button>${t`send`}</button>
      </form>
    </div>
    <div class=-widgetHead><span class=-title>${t`Change password`}</span></div>
    <div>
      <form class=-pwchange>
        <table class=c1-padding>
          <tr><td><input type=password name=old autocomplete=current-password placeholder="${t`old password`}">
          <tr><td><input type=password name=new autocomplete=new-password placeholder="${t`new password`}">
          <tr><td><input type=password name=new2 autocomplete=new-password placeholder="${t`repeat new password`}">
          <tr><td><button>${t`change`}</button>
        </table>
      </form>
    </div>
    <div class=-widgetHead><span class=-title>${t`CMS settings`}</span></div>
    <div>
      <table class=-styled style="width:100%">
        <tr>
          <td>${t`Language`}
          <td><select class=-changelang>
            <option value="" ${lang ? '' : 'selected'}>auto (${t`like website`})
            ${langs.all.map((l) => html`<option ${l === lang ? 'selected' : ''}>${l}`)}
          </select>
        <tr>
          <td>${t`Show content in structure?`}
          <td><input class=-treeShowC type=checkbox ${treeShowC ? 'checked' : ''}>
      </table>
    </div>
    <div class=-widgetHead><span class=-title>${t`About`}</span></div>
    <div>
      <a href="https://vanilla-cms.org/de/home" target=_blank>vanilla-cms.org</a><br>
      Feedback welcome!
    </div>
  </div>`;

  widget.on('click', '.-tour', () => import('../intro.js').then(({ start }) => start()));

  widget.on('submit', '.-feedbackform', async (form, e) => {
    e.preventDefault();
    const msg = form.querySelector('[name=msg]');
    try {
      await api['cms.frontend.4'].feedback.post({ msg: msg.value, link: location.href });
    } catch (err) {
      return dialogs.alert(err.message);
    }
    msg.value = '';
    form.insertAdjacentHTML('beforebegin',
      `<i class=-thanks>${await t`Thank you for your feedback.`} ${await t`We will get back to you as soon as possible.`}</i>`);
  });
  // the draft survives a closed panel; the send clears it server-side
  let draftTimer;
  widget.on('input', '[name=msg]', (inp) => {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(() => setting(['cms', 'feedback', 'text']).put({ value: inp.value }), 300);
  });

  widget.on('submit', '.-pwchange', async (form, e) => {
    e.preventDefault();
    const [oldpw, pw, pw2] = ['old', 'new', 'new2'].map((n) => form.querySelector(`[name=${n}]`).value);
    if (pw !== pw2) return dialogs.alert(t`Passwords do not match`);
    try {
      await api.core.password.put({ oldpw, pw });
      await dialogs.alert(t`Password changed successfully.`);
      form.reset();
    } catch (err) { await dialogs.alert(err.message); }
  });

  widget.on('change', '.-changelang', (sel) => setting(['core', 'lang_ns', 'cms']).put({ value: sel.value }).then(reload));
  widget.on('change', '.-treeShowC', (inp) => setting(['cms.frontend.4', 'ui', 'tree_show_c']).put({ value: inp.checked }).then(reload));
}
