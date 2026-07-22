/* Copyright (c) 2016 Tobias Buschor https://goo.gl/gl0mbf | MIT License https://goo.gl/HgajeK */

// Minimal pointer-drag observer: onstart/onmove/onend + `this.diff` = {x,y,time} delta per move.
class PointerObserver {
  constructor(el, { passive = true } = {}) {
    this.el = el;
    this.diff = { x: 0, y: 0, time: 0 };
    el.addEventListener('pointerdown', e => {
      this._active = e.pointerId;
      this._last = { x: e.clientX, y: e.clientY, t: e.timeStamp };
      try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ }
            this.onstart?.(e);
            const move = ev => {
              if (ev.pointerId !== this._active) return;
              this.diff = { x: ev.clientX - this._last.x, y: ev.clientY - this._last.y, time: ev.timeStamp - this._last.t };
              this._last = { x: ev.clientX, y: ev.clientY, t: ev.timeStamp };
                this.onmove?.(ev);
            };
            const up = ev => {
              if (ev.pointerId !== this._active) return;
              el.removeEventListener('pointermove', move);
              el.removeEventListener('pointerup', up);
              el.removeEventListener('pointercancel', up);
              this._active = null;
                this.onend?.(ev);
            };
            el.addEventListener('pointermove', move, { passive });
            el.addEventListener('pointerup', up);
            el.addEventListener('pointercancel', up);
    }, { passive });
  }
}

const SVG_NS = 'http://www.w3.org/2000/svg';

export class ImageCropper extends EventTarget {

  get right()  { return this.svg.getBoundingClientRect().width  - (this.position.left + this.position.width); }
  get bottom() { return this.svg.getBoundingClientRect().height - (this.position.top  + this.position.height); }

  get top()    { return this.position.top; }
  set top(value) {
    const { height } = this.svg.getBoundingClientRect();
    this.position.top = Math.max(0, Math.min(height - this.position.height, value));
    this.#drawArea();
  }

  get left()   { return this.position.left; }
  set left(value) {
    const { width } = this.svg.getBoundingClientRect();
    this.position.left = Math.max(0, Math.min(width - this.position.width, value));
    this.#drawArea();
  }

  get height() { return this.position.height; }
  set height(value) {
    const { height } = this.svg.getBoundingClientRect();
    value = Math.max(value, this.minHeight || 60);
    value = Math.min(value, height - this.position.top);
    if (this.aspectRatio) this.position.width = value * this.aspectRatio;
    this.position.height = value;
    this.#drawArea();
  }

  get width()  { return this.position.width; }
  set width(value) {
    const { width } = this.svg.getBoundingClientRect();
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
        for (const i of pos) nob.setAttribute('data-manipulate-' + i, true);
        if (pos.length > 1) nob.setAttribute('data-manipulate-edge', true);
        nob.setAttribute('width', 26);
        nob.setAttribute('height', 26);
        nob.setAttribute('fill', '#fff');
        nob.setAttribute('stroke', '#000');
        this.svg.append(nob);
      }
      this.area = this.svg.querySelector('.-area');

      const observer = new PointerObserver(this.svg, { passive: false });
      let started = null;
      let aspectRatio = null;
      let createNew = false;
      observer.onstart = (e) => {
        e.preventDefault();
        started = e.target;
        aspectRatio = started.hasAttribute('data-manipulate-edge') ? this.width / this.height : false;
        createNew = false;
        if (started.classList.contains('-nob')) return;
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
        if (started.classList.contains('-nob') || createNew) {
          const distance = Math.hypot(observer.diff.x, observer.diff.y);
          const speed = observer.diff.time / distance; // milliseconds per pixel
          if (speed > 6) { diffY = diffY / 5; diffX = diffX / 5; }
          if (started.getAttribute('data-manipulate-e') || createNew) {
            this.width = width + diffX;
            if (aspectRatio && !e.shiftKey) this.height = this.width / aspectRatio;
          }
          if (started.getAttribute('data-manipulate-s') || createNew) {
            this.height = height + diffY;
            if (aspectRatio && !e.shiftKey) this.width = this.height * aspectRatio;
          }
          if (started.getAttribute('data-manipulate-w')) {
            this.width = width - diffX;
            if (diffX > 0) diffX = width - this.width; // effective diff
            this.left = x + diffX;
            if (aspectRatio && !e.shiftKey) this.height = this.width / aspectRatio;
          }
          if (started.getAttribute('data-manipulate-n')) {
            this.height = height - diffY;
            if (diffY > 0) diffY = height - this.height;
            this.top = y + diffY;
            if (aspectRatio && !e.shiftKey) this.width = this.height * aspectRatio;
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
        let myX = x + width / 2 - 15;
        let myY = y + height / 2 - 15;
        if (el.hasAttribute('data-manipulate-n')) myY -= height / 2;
        if (el.hasAttribute('data-manipulate-e')) myX += width / 2;
        if (el.hasAttribute('data-manipulate-s')) myY += height / 2;
        if (el.hasAttribute('data-manipulate-w')) myX -= width / 2;
        el.setAttribute('x', myX);
        el.setAttribute('y', myY);
      }
    }
    show() {
      const rect = this.image.getBoundingClientRect();
      this.positionizeSvg();
      this.container.append(this.svg);
      this.left = rect.width * .1;
      this.top = rect.height * .1;
      if (this.aspectRatio > rect.width / rect.height) {
        this.height = rect.height * .8;
        this.width = rect.width * .8;
      } else {
        this.width = rect.width * .8;
        this.height = rect.height * .8;
      }
      addEventListener('resize', this);
      this.dispatchEvent(new Event('show'));
    }
    hide() {
      this.svg.remove();
      removeEventListener('resize', this);
      this.dispatchEvent(new Event('hide'));
    }
    hidden() { return !this.svg.parentNode; }
    toggle() { this.hidden() ? this.show() : this.hide(); }
    handleEvent(e) {
      if (e.type !== 'resize') return;
      this.positionizeSvg();
      this.positionizeNobs();
    }
}
