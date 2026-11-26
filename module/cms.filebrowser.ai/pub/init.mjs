import { dom } from '@qino/pub/c1.js';
import { api } from '@qino/pub/api.js';
import { hee } from '@qino/pub/html.js';
import { t as tGlobal } from '@qino/pub/t.js';

const t = tGlobal.in('cms.filebrowser.ai');

// scoped query helper
const find = (el, sel) => el.querySelector(':scope '+sel);

// The file-browser dialog lives in the CMS panel's shadow DOM.
customElements.whenDefined('qino-cms').then(async () => {
  const { SelectorObserver } = await import('@qino/u2/js/SelectorObserver/SelectorObserver.js');
  const root = document.querySelector('qino-cms').shadowRoot;
  new SelectorObserver({ on: async el => {
    const [tab, hint, button, busy] = (await Promise.all([t`AI`, t`Describe the image in the field above.`, t`Generate`, t`Generating…`])).map(hee);
    const search = find(el, '[type=search]');
    const panel = dom.el(
      `<section class=-ai>
            <p>${hint}</p>
            <button type=button class=-generate>${button}</button>
            <div class=-list></div>
        </section>`
    );
    find(el, 'u2-tabs').append(dom.el(`<h4 slot=title>${tab}</h4>`), panel);

    const list = find(panel, '.-list');

    const generate = async () => {
      const prompt = search.value.trim();
      if (!prompt) return search.focus();
      list.innerHTML = busy;
      // a provider error is shown, the fallback image is still offered
      const urls = await api['ai.api'].image.post({ prompt }).then(urls => (list.innerHTML = '', urls), err => (list.textContent = err.message, []));
      if (!urls.length) urls.push('https://image.pollinations.ai/prompt/' + encodeURIComponent(prompt));
      for (const url of urls) {
        const label = document.createElement('label');
        label.dataset.type = 'url';
        label.setAttribute('itemid', url);
        label.append(
          Object.assign(document.createElement('input'), { type: 'checkbox' }),
          Object.assign(document.createElement('img'), { src: url, referrerPolicy: 'no-referrer', style: 'max-width:100%' }),
        );
        list.append(label);
      }
    };
    find(panel, '.-generate').addEventListener('click', generate);
    // Enter in the shared field generates while this tab is open
    find(el, '.-search').addEventListener('submit', () => panel.hidden || generate());
  }}).observe('.cmsFileBrowser', { root });
});
