c1.onElement('.cmsFileBrowser', el => {
    const mainList = el.c1Find('.-list.-main');
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

    const list = container.c1Find('.-list');

    container.c1Find('form').addEventListener('submit', async e => {
        e.preventDefault();
        const prompt = e.target.prompt.value.trim();
        if (!prompt) return;
        list.innerHTML = 'Generating…';
        try {
            const res = await $fn('ai::imageGenerations')({ prompt });
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
});
