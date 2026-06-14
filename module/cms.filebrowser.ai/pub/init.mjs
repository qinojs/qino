import { apt } from '../../core/pub/js/qino.js';

// scoped query helper
const find = (el, sel) => el.querySelector(':scope '+sel);

// Der Filebrowser-Dialog lebt im Shadow-DOM des CMS-Panels.
customElements.whenDefined('qino-cms').then(async () => {
const { SelectorObserver } = await import('@qino/u2/js/SelectorObserver/SelectorObserver.js');
const root = document.querySelector('qino-cms').shadowRoot;
new SelectorObserver({ on: el => {
    const mainList = find(el, '.-list.-main');
    const container = c1.dom.fragment(
        `<div class=-ai style="padding-top:2em;">
            <h3>AI Image Generation</h3>
            <form>
                <input type=text name=prompt placeholder="Describe an image…" style="width:100%">
                <button type=submit>Generate</button>
            </form>
            <div class=-list></div>
        </div>`
    ).firstChild;
    mainList.after(container);

    const list = find(container, '.-list');

    find(container, 'form').addEventListener('submit', async e => {
        e.preventDefault();
        const prompt = e.target.prompt.value.trim();
        if (!prompt) return;
        list.innerHTML = 'Generating…';
        try {
            const res = await apt.ai['image-generations'].post({ data: { prompt } });
            list.innerHTML = '';
            const urls = res?.data?.map(i => i.url) ?? [];
            if (!urls.length) urls.push('https://image.pollinations.ai/prompt/' + encodeURIComponent(prompt));
            for (const url of urls) {
                const label = c1.dom.fragment(
                    `<label data-type=url itemid="${url}">` +
                        `<input type=checkbox style="position:absolute;top:8px;left:8px">` +
                        `<img src="${url}" referrerpolicy="no-referrer" style="max-width:100%">` +
                    `</label>`
                ).firstChild;
                list.append(label);
            }
        } catch (err) {
            list.textContent = err.message;
        }
    });
}}).observe('.cmsFileBrowser', { root });
});
