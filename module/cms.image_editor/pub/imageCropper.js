/* Copyright (c) 2016 Tobias Buschor https://goo.gl/gl0mbf | MIT License https://goo.gl/HgajeK */

// Minimal pointer-drag observer: onstart/onmove + `this.diff` = {x,y,time} delta per move.
class PointerObserver {
  diff = { x: 0, y: 0, time: 0 };

  constructor(el, { passive = true } = {}) {
    let id = null, last = null;
    const end = (e) => { if (e.pointerId === id) id = null; };
    el.addEventListener('pointerdown', (e) => {
      if (id !== null) return;             // one pointer at a time
      id = e.pointerId;
      last = e;
      try { el.setPointerCapture(id); } catch { /* ignore */ }
      this.onstart?.(e);
    }, { passive });
    el.addEventListener('pointermove', (e) => {
      if (e.pointerId !== id) return;
      this.diff = { x: e.clientX - last.clientX, y: e.clientY - last.clientY, time: e.timeStamp - last.timeStamp };
      last = e;
      this.onmove?.(e);
    }, { passive });
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }
}

const SVG_NS = 'http://www.w3.org/2000/svg';

export class ImageCropper extends EventTarget {
  #size = { width: 0, height: 0 }; // the overlay's own size, kept by positionizeSvg()

  get top()    { return this.position.top; }
  set top(value) {
    const { height } = this.#size;
    this.position.top = Math.max(0, Math.min(height - this.position.height, value));
    this.#drawArea();
  }

  get left()   { return this.position.left; }
  set left(value) {
    const { width } = this.#size;
    this.position.left = Math.max(0, Math.min(width - this.position.width, value));
    this.#drawArea();
  }

  get height() { return this.position.height; }
  set height(value) {
    const { height } = this.#size;
    value = Math.max(value, this.minHeight || 60);
    value = Math.min(value, height - this.position.top);
    if (this.aspectRatio) this.position.width = value * this.aspectRatio;
    this.position.height = value;
    this.#drawArea();
  }

  get width()  { return this.position.width; }
  set width(value) {
    const { width } = this.#size;
    value = Math.max(value, this.minWidth || 60);
    value = Math.min(value, width - this.position.left);
    if (this.aspectRatio) this.position.height = value * (1 / this.aspectRatio);
    this.position.width = value;
    this.#drawArea();
  }
    #drawArea() {
    requestAnimationFrame(() => {
      this.area.setAttribute('y', this.position.top);
      this.area.setAttribute('x', this.position.left);
      this.area.setAttribute('height', this.position.height);
      this.area.setAttribute('width', this.position.width);
      this.dispatchEvent(new Event('crop'));
      this.positionizeNobs();
    });
  }

    /** Set the crop rectangle directly (overlay px), bypassing the drag-resize clamps. */
    setRect(left, top, width, height) {
      this.position = { left, top, width, height };
      this.#drawArea();
    }

    // image:     the canvas the crop overlays
    // container: shadow-root node the (fixed-positioned) svg is appended to
    constructor(image, container) {
      super();
      this.image = image;
      this.container = container;
      this.position = { top: 0, left: 0, height: 0, width: 0 };

      this.svg = document.createElementNS(SVG_NS, 'svg');
      this.svg.classList.add('-cropper');
      this.svg.style.position = 'fixed';
      this.svg.style.overflow = 'visible';
      this.svg.innerHTML = `
            <style>
                .-cropper .-nob { opacity: .6 }
                .-cropper:hover .-nob { opacity: 1 }
            </style>
            <defs>
                <mask id="maskX">
                    <rect fill="#fff" x="0" y="0" width="9100" height="9100"></rect>
                    <rect class="-area" x="0" y="0" width="0" height="0"></rect>
                </mask>
            </defs>
            <rect mask="url(#maskX)" fill="rgba(0,0,0,.5)" x="0" y="0" width="9100" height="9100" style="width:100%;height:100%"></rect>`;
      for (const pos of ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']) {
        const nob = document.createElementNS(SVG_NS, 'rect');
        nob.style.cursor = pos + '-resize';
        nob.classList.add('-nob');
        nob.dataset.pos = pos; // 'n', 'se', … — which edges this nob drags
        nob.setAttribute('width', 26);
        nob.setAttribute('height', 26);
        nob.setAttribute('fill', '#fff');
        nob.setAttribute('stroke', '#000');
        this.svg.append(nob);
      }
      this.area = this.svg.querySelector('.-area');

      const observer = new PointerObserver(this.svg, { passive: false });
      let dir = '';
      let lockRatio = false; // corners keep the ratio while dragging
      let createNew = false;
      observer.onstart = (e) => {
        e.preventDefault();
        dir = e.target.dataset.pos ?? '';
        lockRatio = dir.length > 1 ? this.width / this.height : false;
        createNew = false;
        if (dir) return;                       // dragging a nob, not the area
        const inside = e.offsetX > this.left && e.offsetX < this.left + this.width &&
          e.offsetY > this.top && e.offsetY < this.top + this.height;
        if (!inside) {
          createNew = true;
          this.top = e.offsetY;
          this.left = e.offsetX;
          this.width = 0;
          this.height = 0;
        }
      };
      observer.onmove = (e) => {
        e.preventDefault();
        const x = this.left;
        const y = this.top;
        const width = this.width;
        const height = this.height;
        let diffX = observer.diff.x;
        let diffY = observer.diff.y;
        if (dir || createNew) {
          const distance = Math.hypot(observer.diff.x, observer.diff.y);
          const speed = observer.diff.time / distance; // milliseconds per pixel
          if (speed > 6) { diffY = diffY / 5; diffX = diffX / 5; }
          if (dir.includes('e') || createNew) {
            this.width = width + diffX;
            if (lockRatio && !e.shiftKey) this.height = this.width / lockRatio;
          }
          if (dir.includes('s') || createNew) {
            this.height = height + diffY;
            if (lockRatio && !e.shiftKey) this.width = this.height * lockRatio;
          }
          if (dir.includes('w')) {
            this.width = width - diffX;
            if (diffX > 0) diffX = width - this.width; // effective diff
            this.left = x + diffX;
            if (lockRatio && !e.shiftKey) this.height = this.width / lockRatio;
          }
          if (dir.includes('n')) {
            this.height = height - diffY;
            if (diffY > 0) diffY = height - this.height;
            this.top = y + diffY;
            if (lockRatio && !e.shiftKey) this.width = this.height * lockRatio;
          }
        } else {
          this.top = y + diffY;
          this.left = x + diffX;
        }
      };
    }

    // The svg is position:fixed inside the top-layer dialog → viewport coords, no scroll offset.
    positionizeSvg() {
      const pos = this.image.getBoundingClientRect();
      this.#size = { width: pos.width, height: pos.height };
      Object.assign(this.svg.style, {
        top: pos.top + 'px',
        left: pos.left + 'px',
        width: pos.width + 'px',
        height: pos.height + 'px',
      });
    }
    positionizeNobs() {
      const width = this.width;
      const height = this.height;
      const x = this.left;
      const y = this.top;
      for (const el of this.svg.querySelectorAll('.-nob')) {
        const pos = el.dataset.pos;
        let myX = x + width / 2 - 15;
        let myY = y + height / 2 - 15;
        if (pos.includes('n')) myY -= height / 2;
        if (pos.includes('e')) myX += width / 2;
        if (pos.includes('s')) myY += height / 2;
        if (pos.includes('w')) myX -= width / 2;
        el.setAttribute('x', myX);
        el.setAttribute('y', myY);
      }
    }
    show() {
      this.positionizeSvg();
      this.container.append(this.svg);
      const { width, height } = this.#size;
      this.left = width * .1;
      this.top = height * .1;
      if (this.aspectRatio > width / height) { // the shorter side decides, so it stays inside
        this.height = height * .8;
        this.width = width * .8;
      } else {
        this.width = width * .8;
        this.height = height * .8;
      }
      addEventListener('resize', this);
      this.dispatchEvent(new Event('show'));
    }
    hide() {
      this.svg.remove();
      removeEventListener('resize', this);
      this.dispatchEvent(new Event('hide'));
    }
    toggle() { this.svg.parentNode ? this.hide() : this.show(); }
    handleEvent(e) {
      if (e.type !== 'resize') return;
      this.positionizeSvg();
      this.positionizeNobs();
    }
}
