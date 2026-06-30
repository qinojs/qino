/* Copyright (c) 2016 Tobias Buschor https://goo.gl/gl0mbf | MIT License https://goo.gl/HgajeK */
import { c1FullScreenPopup } from './c1FullScreenPopup.js';
import { c1ImageCropper } from './c1ImageCropper.js';

const seriouslyBase = new URL('./Seriously.js/', import.meta.url).href;

const loadScript = src => new Promise((resolve, reject) => {
    document.head.append(Object.assign(document.createElement('script'), { src, onload: resolve, onerror: reject }));
});

const checkerboard =
    'background-color:#fff; ' +
    'background-image: linear-gradient(45deg, #d8d8d8 25%, transparent 25%, transparent 75%, #d8d8d8 75%, #d8d8d8), linear-gradient(45deg, #d8d8d8 25%, transparent 25%, transparent 75%, #d8d8d8 75%, #d8d8d8); ' +
    'background-size:1.25rem 1.25rem; background-position:0 0, .625rem .625rem; ';

export class c1ImageEditor extends c1FullScreenPopup {
    minHeight = 0;
    minWidth = 0;

    show(src, options) {
        this.options = options;
        this.init();
        const img = this.el('.-img');
        const canvas = this.el('.-canvas');

        this.cropper = new c1ImageCropper(canvas, this.el());
        this.cropper.addEventListener('show', () => {
            this.el('.-tools').style.display = 'none';
            this.el('.-btns').style.display = 'none';
            this.el('.-toolsCrop').style.display = 'block';
            this.cropper.positionizeSvg();
        });
        this.cropper.addEventListener('hide', () => {
            this.el('.-tools').style.display = 'block';
            this.el('.-btns').style.display = 'block';
            this.el('.-toolsCrop').style.display = 'none';
        });
        this.cropper.addEventListener('crop', () => {
            for (const prop of ['top', 'left', 'width', 'height']) {
                const el = this.el(`.-cropValues [name=${prop}]`);
                if (el === this.activeEl) continue;
                el.value = Math.round(this.cropper[prop] * this.scale);
            }
        });

        img.onload = () => {
            options.onload?.();
            canvas.width = img.naturalWidth;
            canvas.height = img.naturalHeight;
            this.initSeriously();
            this.resetCropper();
            URL.revokeObjectURL(img.src);
        };
        img.onerror = () => {
            alert('Das Bild konnte nicht geladen werden, oder ist nicht vorhanden. Klicken Sie auf "hochladen" um ein Bild von Ihrem Computer auszuwählen.');
            options.onerror?.();
        };
        img.src = src;
        this.el('.-save').onclick = () => {
            this.changed = false;
            options.onsave();
        };
        super.show();
        addEventListener('resize', this);
    }
    hide() {
        if (this.changed && !confirm('Möchten Sie die Änderungen verwerfen?')) return;
        this.cropper.hide();
        removeEventListener('resize', this);
        super.hide();
    }
    async uploadDialog() {
        await import('../../core/pub/js/c1/form.mjs');
        const [file] = await c1.form.fileDialog({ multiple: false, accept: 'image/*' });
        if (!file?.type.match('image.*')) return;
        this.el('.-img').src = URL.createObjectURL(file);
    }
    init() {
        this.el().innerHTML = `
            <div style="display:flex; flex:1 1 auto;">
                <div class="-viewport" style="position:relative; flex:1 1 auto; background:#000">
                    <div style="display:flex; justify-content:center; position:absolute; inset:0; overflow:auto; padding:1.25rem;">
                        <canvas class="-canvas" style="background:#bbb; display:block; box-shadow:0 0 2.5rem #888; margin:auto; max-height:100%; max-width:100%; ${checkerboard}"></canvas>
                        <img class="-img" style="display:none; margin:auto; max-height:100%; max-width:100%">
                    </div>
                </div>
                <div class="-sidebar" style="min-width:17.5rem; padding:1.25rem; display:flex; flex-flow:column">
                    <div class="-tools" style="flex:auto; overflow:auto">
                        <div class="-title">Bild bearbeiten</div>
                        <br>
                        <button class="-rotate">90° drehen</button>
                        <button class="-crop">zuschneiden</button>
                        <button class="-upload">hochladen</button>
                        <div class="c1AccordionHead" tabindex="-1">Einstellen</div>
                        <div>
                            <div>Helligkeit</div>
                            <input class="-brightness" type="range" style="width:100%" min=".4" max="2" step="any" value="1">
                            <div>Kontrast</div>
                            <input class="-contrast" type="range" style="width:100%" min=".4" max="2" step="any" value="1">
                        </div>
                    </div>
                    <div class="-toolsCrop" style="flex:auto; overflow:auto" hidden>
                        <div class="-title">Bild zuschneiden</div>
                        <br>
                        <div style="display:flex;">
                            <button class="-cancelCrop" style="flex:1">abbrechen</button>
                            <span style="flex:.1 1 .5rem;"></span>
                            <button class="-cropit" style="flex:1">zuschneiden</button>
                        </div>
                        <br>
                        <form class="-cropValues">
                            <table style="width:100%"><tbody style="vertical-align:middle">
                                <tr> <td> X:      <td> <input name="top"    type="number" style="width:100%">
                                <tr> <td> Y:      <td> <input name="left"   type="number" style="width:100%">
                                <tr> <td> Breite: <td> <input name="width"  type="number" style="width:100%">
                                <tr> <td> Höhe:   <td> <input name="height" type="number" style="width:100%">
                            </table>
                        </form>
                    </div>
                    <div class="-btns" style="flex:0">
                        <div style="display:flex; margin:-.625rem">
                            <button style="flex:1; margin:.625rem" class="-save">Speichern</button>
                            <button style="display:none; flex:1; margin:.625rem" class="-cancel">Abbrechen</button>
                        </div>
                    </div>
                </div>
            </div>`;
        this.el('.-cancel').addEventListener('click', () => this.hide());
        this.el('.-upload').addEventListener('click', () => this.uploadDialog());
        this.el('.-cancelCrop').addEventListener('click', () => this.cropper.hide());
    }
    async initSeriously() {
        if (this.initialized) return;
        const run = () => {
            this.initialized = true;
            const seriously = new Seriously();
            const target = seriously.target(this.el('.-canvas'));

            this.el('.-img').addEventListener('load', () => {
                target.width = this.el('.-img').naturalWidth;
                target.height = this.el('.-img').naturalHeight;
                this.el('.-brightness').value = effect.brightness = 1;
                this.el('.-contrast').value = effect.contrast = 1;
                crop.top = crop.left = crop.bottom = crop.right = 0;
                rotate.rotation = 0;
                this.changed = true;
            });

            // effect
            const effect = seriously.effect('brightness-contrast');
            effect.source = seriously.source(this.el('.-img'));
            this.el('.-brightness').addEventListener('input', c1.debounce(e => { effect.brightness = e.target.value; this.changed = true; }, 10));
            this.el('.-contrast').addEventListener('input', c1.debounce(e => { effect.contrast = e.target.value; this.changed = true; }, 10));

            // crop
            this.el('.-crop').addEventListener('click', () => this.cropper.toggle());
            const crop = seriously.effect('crop');
            crop.source = effect;

            const cropit = () => {
                crop.top = this.scale * this.cropper.top;
                crop.left = this.scale * this.cropper.left;
                crop.bottom = this.scale * this.cropper.bottom;
                crop.right = this.scale * this.cropper.right;
                this.cropper.hide();
            };
            this.cropper.svg.addEventListener('dblclick', cropit);
            this.el('.-cropit').addEventListener('click', cropit);
            this.el().addEventListener('keydown', e => {
                if (e.key === 'Enter' && this.cropper.svg.parentNode) {
                    cropit();
                    this.el().focus(); // prevent the activated button from re-triggering click
                }
            });
            this.el('.-cropValues').addEventListener('input', c1.debounce(e => {
                this.cropper[e.target.name] = e.target.value / this.scale;
            }, 200));

            crop.on('resize', () => {
                if (crop.top === 0 && crop.left === 0 && crop.bottom === 0 && crop.right === 0) return;
                target.width = crop.width;
                target.height = crop.height;
                rewriteImgSource();
            });

            const rewriteImgSource = c1.debounce(() => {
                const sidebar = this.el('.-sidebar');
                sidebar.style.opacity = .4;
                sidebar.style.pointerEvents = 'none';
                this.el('.-canvas').toBlob(result => {
                    sidebar.style.opacity = '';
                    sidebar.style.pointerEvents = '';
                    this.el('.-img').src = URL.createObjectURL(result);
                });
            }, 100);

            // rotate
            const rotate = seriously.transform('2d');
            rotate.source = crop;
            this.el('.-rotate').addEventListener('click', () => {
                const w = target.width;
                target.width = target.height;
                target.height = w;
                rotate.rotation += 90;
                rewriteImgSource();
            });

            // go
            target.source = rotate;
            seriously.go();
        };
        await loadScript(seriouslyBase + 'lib/require.js');
        require([seriouslyBase + 'seriously.js'], () => {
            require([
                seriouslyBase + 'effects/seriously.brightness-contrast.js',
                seriouslyBase + 'effects/seriously.crop.js',
            ], run);
        });
    }
    handleEvent(e) {
        if (e.type !== 'resize') return;
        this.resetCropper();
    }
    resetCropper() {
        const canvas = this.el('.-canvas');
        this.scale = canvas.width / canvas.clientWidth;
        this.cropper.minHeight = this.minHeight / this.scale;
        this.cropper.minWidth = this.minWidth / this.scale;
    }
}
