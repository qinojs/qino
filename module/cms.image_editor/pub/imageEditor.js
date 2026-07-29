import { FullScreenDialog } from './fullScreenDialog.js';
import { ImageCropper } from './imageCropper.js';
import { ImageCanvas } from './imageCanvas.js';

const checkerboard =
    'background-color:#fff; ' +
    'background-image: linear-gradient(45deg, #d8d8d8 25%, transparent 25%, transparent 75%, #d8d8d8 75%, #d8d8d8), linear-gradient(45deg, #d8d8d8 25%, transparent 25%, transparent 75%, #d8d8d8 75%, #d8d8d8); ' +
    'background-size:1.25rem 1.25rem; background-position:0 0, .625rem .625rem; ';

export class ImageEditor extends FullScreenDialog {
    minHeight = 0;
    minWidth = 0;

    show(src, options = {}) {
      this.init();
      const img = this.el('.-img');
      this.img = new ImageCanvas(this.el('.-canvas'));

      this.#initCropper();
      this.#wireTools();

      img.onload = () => {
        this.img.load(img);
        this.resetCropper();
            options.onload?.();
            URL.revokeObjectURL(img.src);
      };
      img.onerror = () => {
        alert('Das Bild konnte nicht geladen werden, oder ist nicht vorhanden. Klicken Sie auf "hochladen" um ein Bild von Ihrem Computer auszuwählen.');
            options.onerror?.();
      };
      img.src = src;
      this.el('.-save').onclick = () => {
        this.changed = false;
            options.onsave?.();
      };
      super.show();
      addEventListener('resize', this);
    }

    #initCropper() {
      this.cropper = new ImageCropper(this.el('.-canvas'), this.el());
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
    }

    #wireTools() {
      // brightness / contrast — live adjustments.
      // Read the value synchronously: event.target is unreliable in a deferred (debounced) callback (Firefox).
      const adjust = prop => {
        const apply = c1.debounce(v => { this.img[prop] = v; this.img.render(); this.changed = true; }, 10);
        return e => apply(+e.target.value);
      };
      this.el('.-brightness').addEventListener('input', adjust('brightness'));
      this.el('.-contrast').addEventListener('input', adjust('contrast'));

      // rotate
      this.el('.-rotate').addEventListener('click', () => this.#bake(this.img.rotateRight()));

      // crop
      this.el('.-crop').addEventListener('click', () => this.cropper.toggle());
      const cropit = () => {
        const s = this.scale;
        this.#bake(this.img.crop(s * this.cropper.left, s * this.cropper.top, s * this.cropper.width, s * this.cropper.height));
        this.cropper.hide();
      };
      this.cropper.svg.addEventListener('dblclick', cropit);
      this.el('.-cropit').addEventListener('click', cropit);

      // auto-crop: select the content bounds (uniform border trimmed away), confirm with "zuschneiden"
      this.el('.-autocrop').addEventListener('click', () => {
        const box = this.img.contentBox();
        if (!box) return;
        const s = this.scale;
        this.cropper.setRect(box.x / s, box.y / s, box.w / s, box.h / s);
      });
      this.el().addEventListener('keydown', e => {
        if (e.key === 'Enter' && this.cropper.svg.parentNode) {
          cropit();
          this.el().focus(); // prevent the activated button from re-triggering click
        }
      });
      const applyCropValue = c1.debounce((name, value) => { this.cropper[name] = value / this.scale; }, 200);
      this.el('.-cropValues').addEventListener('input', e => applyCropValue(e.target.name, +e.target.value));
    }

    // Apply a geometry change (crop/rotate) and re-sync the cropper to the new canvas size.
    #bake(promise) {
      this.changed = true;
      promise.then(() => requestAnimationFrame(() => this.resetCropper()));
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
                        <div class="-accordion" tabindex="-1">Einstellen</div>
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
                        <button class="-autocrop" style="width:100%; margin-top:.5rem">automatisch</button>
                        <br>
                        <form class="-cropValues">
                            <table style="width:100%"><tbody style="vertical-align:middle">
                                <tr> <td> X:      <td> <input name="left"   type="number" style="width:100%">
                                <tr> <td> Y:      <td> <input name="top"    type="number" style="width:100%">
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
