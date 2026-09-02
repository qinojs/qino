/* Standalone by design: this file and the ones it imports pull in nothing else and use no
 * globals, so the editor runs on any page — see test/imageEditor.html.
 * Anything that needs the cms (api, upload, styles) belongs in DbFileImageEditor. */
import { FullScreenDialog } from './fullScreenDialog.js';
import { ImageCropper } from './imageCropper.js';
import { ImageCanvas } from './imageCanvas.js';

/** Trailing debounce, but never quiet for longer than 2×ms — a slider drag keeps updating. */
export const debounce = (fn, ms) => {
  let args, min, max;
  const run = () => { clearTimeout(min); clearTimeout(max); max = 0; fn(...args); };
  return (...a) => {
    args = a;
    clearTimeout(min);
    min = setTimeout(run, ms);
    max ||= setTimeout(run, ms * 2);
  };
};

const pickFile = (accept) => new Promise((resolve) => {
  const input = Object.assign(document.createElement('input'), { type: 'file', accept });
  input.style.cssText = 'position:absolute; left:-999px; opacity:.01';
  input.addEventListener('change', () => { resolve(input.files[0]); input.remove(); }, { once: true });
  document.body.append(input);
  input.click();
});

const CHECKERBOARD = 'linear-gradient(45deg, #d8d8d8 25%, transparent 25%, transparent 75%, #d8d8d8 75%, #d8d8d8)';

const CSS = `
dialog {
    .-main { display: flex; flex: 1 1 auto; }

    .-viewport {
        position: relative;
        flex: 1 1 auto;
        background: #000;
    }
    .-stage {
        position: absolute;
        inset: 0;
        display: flex;
        justify-content: center;
        overflow: auto;
        padding: 1.25rem;
    }
    .-canvas, .-img { margin: auto; max-height: 100%; max-width: 100%; }
    .-canvas {
        display: block;
        box-shadow: 0 0 2.5rem #888;
        background-color: #fff;
        background-image: ${CHECKERBOARD}, ${CHECKERBOARD};
        background-size: 1.25rem 1.25rem;
        background-position: 0 0, .625rem .625rem;
    }
    .-img { display: none; }

    .-sidebar { min-width: 17.5rem; padding: 1.25rem; display: flex; flex-flow: column; }
    .-tools, .-toolsCrop { flex: auto; overflow: auto; }
    .-brightness, .-contrast { width: 100%; }

    .-cropBtns {
        display: flex;
        gap: .5rem;
        & > button { flex: 1; }
    }
    .-autocrop { width: 100%; margin-top: .5rem; }
    .-cropValues {
        table { width: 100%; }
        tbody { vertical-align: middle; }
        input { width: 100%; }
    }

    .-btns {
        flex: 0;
        display: flex;
        gap: 1.25rem;
        & > button { flex: 1; }
    }
    .-cancel { display: none; }
}
`;

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
      img.onerror = async () => {
        await this.alert('Das Bild konnte nicht geladen werden, oder ist nicht vorhanden. Klicken Sie auf "hochladen" um ein Bild von Ihrem Computer auszuwählen.');
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
      const cropping = (on) => {
        this.el('.-tools').hidden = on;
        this.el('.-btns').hidden = on;
        this.el('.-toolsCrop').hidden = !on;
      };
      this.cropper.addEventListener('show', () => { cropping(true); this.cropper.positionizeSvg(); });
      this.cropper.addEventListener('hide', () => cropping(false));
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
        const apply = debounce(v => { this.img[prop] = v; this.img.render(); this.changed = true; }, 10);
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
      const applyCropValue = debounce((name, value) => { this.cropper[name] = value / this.scale; }, 200);
      this.el('.-cropValues').addEventListener('input', e => applyCropValue(e.target.name, +e.target.value));
    }

    // Apply a geometry change (crop/rotate) and re-sync the cropper to the new canvas size.
    #bake(promise) {
      this.changed = true;
      promise.then(() => requestAnimationFrame(() => this.resetCropper()));
    }

    async hide() {
      if (this.changed && !await this.confirm('Möchten Sie die Änderungen verwerfen?')) return;
      this.cropper.hide();
      removeEventListener('resize', this);
      super.hide();
    }

    async uploadDialog() {
      const file = await pickFile('image/*');
      if (!file?.type.match('image.*')) return;
      this.el('.-img').src = URL.createObjectURL(file);
    }

    init() {
      this.css(CSS);
      this.el().innerHTML = `
            <div class=-main>
                <div class=-viewport>
                    <div class=-stage>
                        <canvas class=-canvas></canvas>
                        <img class=-img>
                    </div>
                </div>
                <div class=-sidebar>
                    <div class=-tools>
                        <div class=-title>Bild bearbeiten</div>
                        <br>
                        <button class=-rotate>90° drehen</button>
                        <button class=-crop>zuschneiden</button>
                        <button class=-upload>hochladen</button>
                        <div class=-accordion tabindex=-1>Einstellen</div>
                        <div>
                            <div>Helligkeit</div>
                            <input class=-brightness type=range min=".4" max=2 step=any value=1>
                            <div>Kontrast</div>
                            <input class=-contrast type=range min=".4" max=2 step=any value=1>
                        </div>
                    </div>
                    <div class=-toolsCrop hidden>
                        <div class=-title>Bild zuschneiden</div>
                        <br>
                        <div class=-cropBtns>
                            <button class=-cancelCrop>abbrechen</button>
                            <button class=-cropit>zuschneiden</button>
                        </div>
                        <button class=-autocrop>automatisch</button>
                        <br>
                        <form class=-cropValues>
                            <table><tbody>
                                <tr> <td> X:      <td> <input name=left   type=number>
                                <tr> <td> Y:      <td> <input name=top    type=number>
                                <tr> <td> Breite: <td> <input name=width  type=number>
                                <tr> <td> Höhe:   <td> <input name=height type=number>
                            </table>
                        </form>
                    </div>
                    <div class=-btns>
                        <button class=-save>Speichern</button>
                        <button class=-cancel>Abbrechen</button>
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

customElements.define('qino-image-editor', ImageEditor);
