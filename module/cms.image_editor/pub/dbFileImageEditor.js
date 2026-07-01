/* Copyright (c) 2016 Tobias Buschor https://goo.gl/gl0mbf | MIT License https://goo.gl/HgajeK */
import { ImageEditor } from './imageEditor.js';
import { apt, ctx } from '../../core/pub/js/qino.js';
import '../../core/pub/js/qg/fileHelpers.mjs'; // globalThis.qgfileUpload

const meta = id => apt['cms.image_editor'].meta(id);
const loadingMjs = () => import('../../core/pub/js/c1/loading.mjs');

// accordion + hotspot styles, scoped to the editor's shadow root
const editorCss = `
.-accordion {
    position: relative;
    background-color: var(--cms-light);
    color: var(--cms-dark);
    padding: .8em 1.2em .7em 1.2em;
    cursor: pointer;
    margin-top: 1em;
    transition: all .1s;
    -webkit-tap-highlight-color: rgba(0, 0, 0, 0);
}
.-accordion::after {
    font-family: 'qg_cms';
    content: '\\e800';
    position: absolute;
    display: flex;
    align-items: center;
    right: .8em;
    top: .7em;
    bottom: .7em;
    padding-left: .625rem;
    transition: opacity .2s;
}
.-accordion:hover::after { opacity: 1; }
.-accordion:first-child { margin-top: 0; }
.-accordion:focus { color: #fff; background-color: var(--cms-dark); }
.-accordion:focus::after { content: '\\e801'; }
.-accordion + div {
    border: 1px solid var(--cms-light);
    transition-duration: .2s;
    transition-property: max-height, padding;
    max-height: 0;
    padding: 0 .9375rem;
    overflow: hidden;
}
.-accordion + div:focus-within,
.-accordion:focus + div {
    max-height: 90vh;
    padding: .9375rem;
    overflow: auto;
}
.-accordion.-title:first-child { background-color: rgb(60, 60, 60); color: #fff; }
.-accordion.-title:first-child::after { content: '\\e902'; }
.-hotspot {
    position: absolute;
    width: 1.25rem;
    height: 1.25rem;
    border-radius: 50%;
    background: #f00;
    pointer-events: none;
    opacity: .2;
}
.-viewport:hover > .-hotspot { opacity: .6; }
.-hotspot > div {
    position: absolute;
    bottom: -1.25rem;
    left: 50%;
    transform: translateX(-50%);
    white-space: nowrap;
    color: #fff;
    text-shadow: 0 0 .625rem #000;
}`;

export class DbFileImageEditor extends ImageEditor {
    show(src, options = {}) {
        const eSrc = src.replace(/(dbFile\/[0-9]+\/).*/, '$1');
        const uniqueMatch = src.match(/\/(u-[^/]+\/)/);
        const unique = uniqueMatch ? uniqueMatch[1] : '';
        this.file_id = eSrc.match(/dbFile\/([0-9]+)\//)[1];

        this.shadow.append(Object.assign(document.createElement('style'), { textContent: editorCss }));

        super.show(eSrc + unique + 'img.jpg', {
            onload: this.loading(() => {
                let width = src.match(/\/w-([0-9]+)(\/|$)/);
                let height = src.match(/\/h-([0-9]+)(\/|$)/);
                width = width && width[1];
                height = height && height[1];

                // "max" means the image is scaled to fit width/height; without it the server crops.
                const maxMatch = src.match(/\/max-?([^/]*)(\/|$)/);
                let max = false;
                if (maxMatch) max = maxMatch[1] === '' ? true : !!parseInt(maxMatch[1]);

                if (width) this.minWidth = width * 2;   // *2 => retina
                if (height) this.minHeight = height * 2;

                if (width && height && !max) {
                    const img = this.el('.-img');
                    const aspectRatio = width / height;
                    this.cropper.aspectRatio = aspectRatio;
                    const naturalAspectRatio = img.naturalWidth / img.naturalHeight;
                    if (aspectRatio.toFixed(1) !== naturalAspectRatio.toFixed(1)) {
                        setTimeout(() => this.cropper.show());
                    }
                }
            }),
            onerror: () => this.loading()(),
            onsave: () => this.upload(this.loading(() => this.hide())),
        });

        // history
        this.el('.-tools').insertAdjacentHTML('beforeend',
            '<div class="-accordion" tabindex="-1">Verlauf</div><div class="-history"></div>');
        setTimeout(() => this.loadHistory(), 100);

        // accordion-style the title heads; the first one doubles as a close button
        let head = this.el('.-tools :first-child');
        head.classList.add('-accordion');
        head.onclick = () => this.hide();
        head = this.el('.-toolsCrop :first-child');
        head.classList.add('-accordion');
        head.onclick = () => this.cropper.hide();

        // meta
        this.meta = {};
        this.el('.-tools').insertAdjacentHTML('beforeend',
            '<div class="-accordion" tabindex="-1">Meta-Daten</div>' +
            '<div class="-meta"><input name="name" placeholder="Dateiname" style="width:100%"><br></div>');
        const saveName = c1.debounce(name => { this.meta.name = name; meta(this.file_id).put({ name }); }, 500);
        this.el('.-meta [name=name]').addEventListener('input', e => saveName(e.target.value));

        // hotspot: click/tap the canvas to set the focus point
        this.el('.-canvas').addEventListener('pointerdown', e => {
            if (e.button !== 0) return; // primary button only
            const rect = this.el('.-canvas').getBoundingClientRect();
            const hpos = ((e.clientX - rect.left) / rect.width) * 100;
            const vpos = ((e.clientY - rect.top) / rect.height) * 100;
            meta(this.file_id).put({ hpos, vpos }).then(() => {
                this.meta.hpos = hpos;
                this.meta.vpos = vpos;
                this.renderHotspot();
            });
        });

        meta(this.file_id).get().then(data => {
            this.meta = data;
            this.el('.-viewport').insertAdjacentHTML('beforeend', '<div class="-hotspot"><div>Hotspot</div></div>');
            this.renderHotspot();
            this.el('.-meta [name=name]').value = data.name;
        });
    }
    renderHotspot() {
        const hotspot = this.el('.-hotspot');
        if (!hotspot) return;
        if (this.meta.hpos == null || this.meta.vpos == null) { hotspot.style.display = 'none'; return; }
        hotspot.style.display = '';
        const cRect = this.el('.-canvas').getBoundingClientRect();
        const vRect = this.el('.-viewport').getBoundingClientRect();
        const x = (cRect.left - vRect.left) + cRect.width * (this.meta.hpos / 100);
        const y = (cRect.top - vRect.top) + cRect.height * (this.meta.vpos / 100);
        hotspot.style.left = x - hotspot.offsetWidth / 2 + 'px';
        hotspot.style.top = y - hotspot.offsetHeight / 2 + 'px';
    }
    handleEvent(e) {
        super.handleEvent(e);
        if (e.type === 'resize') this.renderHotspot();
    }
    // keep the hotspot aligned after crop/rotate resizes the canvas
    resetCropper() {
        super.resetCropper();
        this.renderHotspot();
    }
    async upload(cb) {
        // transparency → PNG; otherwise the smaller of jpeg/png
        let blob;
        if (this.img.hasAlpha()) {
            blob = await this.img.toBlob('image/png', 1);
        } else {
            const [jpeg, png] = await Promise.all([this.img.toBlob('image/jpeg', 1), this.img.toBlob('image/png', 1)]);
            blob = jpeg.size > png.size ? png : jpeg;
        }
        qgfileUpload(blob, 'editedImage', {
            url: ctx.appURL + '?file_id=' + this.file_id,
            complete: () => {
                this.reloadElements();
                cb?.();
            },
        });
    }
    loading(fn) {
        const sidebar = this.el('.-sidebar');
        loadingMjs().then(() => sidebar && c1.loading.mark(sidebar));
        return () => {
            loadingMjs().then(() => sidebar && c1.loading.done(sidebar));
            return fn?.();
        };
    }
    // Re-fetch every <img> of the edited file by swapping its cache-busting `u-…` segment.
    reloadElements() {
        const bust = 'u-' + Date.now().toString(36);
        for (const img of document.images) {
            if (img.src.includes('dbFile/' + this.file_id + '/')) img.src = img.src.replace(/\/u-[^/]+\//, '/' + bust + '/');
        }
    }
    loadHistory() {
        apt['cms.image_editor'].history(this.file_id).get().then(res => {
            this.el('.-history').innerHTML = `<div style="max-height:25rem; overflow:auto">${res}</div>`;
        });
        this.el('.-history').onclick = e => {
            const log = parseInt(e.target.getAttribute('log'), 10);
            if (!Number.isFinite(log)) return;
            if (!confirm('Möchten Sie das Bild wiederherstellen?')) return;
            apt['cms.image_editor'].restore(this.file_id).post({ log: log + 1 })
                .then(() => { location.href = location.href.replace(/#.*$/, ''); })
                .catch(err => alert('Wiederherstellen fehlgeschlagen: ' + err.message));
        };
    }
}
