/* Copyright (c) 2016 Tobias Buschor https://goo.gl/gl0mbf | MIT License https://goo.gl/HgajeK */
import { api } from '@qino/pub/api.js';
import { ctx } from '@qino/pub/qino.js';

import { qgfileUpload } from '../../cms/pub/js/fileHelpers.mjs';
import { debounce, ImageEditor } from './imageEditor.js';

const meta = id => api['cms.image_editor'].meta(id);
const loadingMjs = () => import('@qino/pub/c1/loading.mjs');

// accordion + hotspot styles, scoped to the editor by css()
const EDITOR_CSS = `
.-accordion {
    position: relative;
    background-color: var(--cms-light);
    color: var(--cms-dark);
    padding: .8em 1.2em .7em 1.2em;
    cursor: pointer;
    margin-top: 1em;
    transition: all .1s;
    -webkit-tap-highlight-color: rgba(0, 0, 0, 0);

    &::after {
        font-family: 'Material Icons';
        content: 'expand_more';
        position: absolute;
        display: flex;
        align-items: center;
        right: .8em;
        top: .7em;
        bottom: .7em;
        padding-left: .625rem;
        transition: opacity .2s;
    }
    &:hover::after { opacity: 1; }
    &:first-child { margin-top: 0; }
    &:focus {
        color: #fff;
        background-color: var(--cms-dark);
        &::after { content: 'expand_less'; }
    }
    &.-title:first-child {
        background-color: rgb(60, 60, 60);
        color: #fff;
        &::after { content: 'close'; }
    }

    & + div {
        border: 1px solid var(--cms-light);
        transition-duration: .2s;
        transition-property: max-height, padding;
        max-height: 0;
        padding: 0 .9375rem;
        overflow: hidden;
    }
    & + div:focus-within,
    &:focus + div {
        max-height: 90vh;
        padding: .9375rem;
        overflow: auto;
    }
}
.-hotspot {
    position: absolute;
    width: 1.25rem;
    height: 1.25rem;
    border-radius: 50%;
    background: #f00;
    pointer-events: none;
    opacity: .2;

    & > div {
        position: absolute;
        bottom: -1.25rem;
        left: 50%;
        transform: translateX(-50%);
        white-space: nowrap;
        color: #fff;
        text-shadow: 0 0 .625rem #000;
    }
}
.-viewport:hover > .-hotspot { opacity: .6; }`;

export class DbFileImageEditor extends ImageEditor {
  show(src) {
    const eSrc = src.replace(/(dbFile\/[0-9]+\/).*/, '$1');
    const unique = src.match(/\/(u-[^/]+\/)/)?.[1] ?? '';
    this.file_id = eSrc.match(/dbFile\/([0-9]+)\//)[1];

    this.css(EDITOR_CSS);

    super.show(eSrc + unique + 'img.jpg', {
      onload: this.loading(() => {
        const width = src.match(/\/w-([0-9]+)(\/|$)/)?.[1];
        const height = src.match(/\/h-([0-9]+)(\/|$)/)?.[1];

        // "max" means the image is scaled to fit width/height; without it the server crops.
        const maxMatch = src.match(/\/max-?([^/]*)(\/|$)/);
        const max = !!maxMatch && (maxMatch[1] === '' || !!parseInt(maxMatch[1]));

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
      '<div class=-accordion tabindex=-1>Verlauf</div><div class=-history></div>');
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
      '<div class=-accordion tabindex=-1>Meta-Daten</div>' +
            '<div class=-meta><input name=name placeholder="Dateiname" style="width:100%"><br></div>');
    const saveName = debounce(name => { this.meta.name = name; meta(this.file_id).put({ name }); }, 500);
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
      this.el('.-viewport').insertAdjacentHTML('beforeend', '<div class=-hotspot><div>Hotspot</div></div>');
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
      url: ctx.appUrl + '?file_id=' + this.file_id,
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
    api['cms.image_editor'].history(this.file_id).get().then(res => {
      this.el('.-history').innerHTML = `<div style="max-height:25rem; overflow:auto">${res}</div>`;
    });
    this.el('.-history').onclick = async e => {
      const log = parseInt(e.target.getAttribute('log'), 10);
      if (!Number.isFinite(log)) return;
      if (!await this.confirm('Möchten Sie das Bild wiederherstellen?')) return;
      api['cms.image_editor'].restore(this.file_id).post({ log: log + 1 })
        .then(() => { location.href = location.href.replace(/#.*$/, ''); })
        .catch(err => this.alert('Wiederherstellen fehlgeschlagen: ' + err.message));
    };
  }
}

customElements.define('qino-dbfile-image-editor', DbFileImageEditor);
