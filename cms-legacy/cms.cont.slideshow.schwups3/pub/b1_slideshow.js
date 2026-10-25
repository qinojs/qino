// <b1-slider mode=slide|fade|scroll play controls>: its children become slides. The PHP CMS's
// b1_slideshow, without the c1 library. Speeds come from css: --b1-slider-slideshow-speed (6s),
// --b1-slider-animation-speed (1s).
const arrow = '<svg viewBox="0 0 9 18"><path d="M1 1l7 8-7 8"/></svg>';

class B1Slider extends HTMLElement {
  #slider; #active; #timer;

  connectedCallback() {
    if (this.#slider) return;
    const container = Object.assign(document.createElement('div'), { className: 'b1_slideshow' });
    this.#slider = Object.assign(document.createElement('div'), { className: '-slider' });
    this.#slider.id ||= 'b1-slider-' + Math.random().toString(36).slice(2);
    container.append(this.#slider);
    this.#slider.append(...this.children);
    this.append(container);
    this.setAttribute('item-count', this.#slider.children.length);
    const mode = ['slide', 'fade', 'scroll'].includes(this.getAttribute('mode')) ? this.getAttribute('mode') : 'slide';
    container.dataset.mode = this.mode = mode;
    if (this.hasAttribute('controls')) {
      for (const [dir, label] of [['prev', 'previous slide'], ['next', 'next slide']]) {
        const btn = Object.assign(document.createElement('button'), { className: `-arrow -${dir} -ctrl`, innerHTML: arrow });
        btn.setAttribute('aria-label', label);
        btn.setAttribute('aria-controls', this.#slider.id);
        btn.addEventListener('click', () => this[dir]());
        dir === 'prev' ? this.prepend(btn) : this.append(btn);
      }
    }
    if (mode === 'slide') this.#swipe();
    if (this.hasAttribute('play')) this.addEventListener('b1-slider.slide', () => this.#later());
    setTimeout(() => this.#active || this.next());
  }

  get index() { return [...this.#slider.children].indexOf(this.#active); }

  slideTo(target) {
    if (typeof target === 'number') target = this.#slider.children[target];
    if (!target) return;
    if (this.#active !== target) {
      this.#active?.classList.remove('-active');
      this.#active = target;
      target.classList.add('-active');
      for (const slide of this.#slider.children) slide.setAttribute('aria-hidden', String(slide !== target));
      target.dispatchEvent(new CustomEvent('b1-slider.slide', { bubbles: true, detail: { slide: target, index: this.index, slider: this } }));
    }
    if (this.mode === 'slide') requestAnimationFrame(() => this.#slider.style.transform = `translateX(-${100 * this.index}%)`);
    if (this.mode === 'scroll') this.#slider.scroll({ left: target.offsetLeft, behavior: 'smooth' });
  }

  next() { this.slideTo(this.#active?.nextElementSibling ?? this.#slider.firstElementChild); }
  prev() { this.slideTo(this.#active?.previousElementSibling ?? this.#slider.lastElementChild); }

  #later() {
    clearTimeout(this.#timer);
    const value = getComputedStyle(this).getPropertyValue('--b1-slider-slideshow-speed').trim() || '6000';
    const ms = parseFloat(value) * (value.endsWith('ms') ? 1 : value.endsWith('s') ? 1000 : 1);
    this.#timer = setTimeout(() => this.next(), ms);
  }

  #swipe() {
    let startX, startTranslate, lastX, lastDx = 0;
    const translate = () => new DOMMatrix(getComputedStyle(this.#slider).transform).m41;
    this.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.-ctrl') || e.button) return;
      startX = lastX = e.clientX;
      startTranslate = translate();
      this.#slider.style.transition = 'none';
      this.#slider.style.transform = `translateX(${startTranslate}px)`;
      this.setPointerCapture(e.pointerId);
    });
    this.addEventListener('pointermove', (e) => {
      if (startX === undefined) return;
      lastDx = e.clientX - lastX;
      lastX = e.clientX;
      this.#slider.style.transform = `translateX(${startTranslate + e.clientX - startX}px)`;
    });
    const stop = () => {
      if (startX === undefined) return;
      startX = undefined;
      const width = this.offsetWidth;
      const x = -translate() - Math.max(-width, Math.min(lastDx * 50, width));
      const i = Math.max(0, Math.min(Math.round(x / width), this.#slider.children.length - 1));
      this.#slider.style.transition = '';
      this.slideTo(i);
    };
    this.addEventListener('pointerup', stop);
    this.addEventListener('pointercancel', stop);
  }
}
if (!customElements.get('b1-slider')) customElements.define('b1-slider', B1Slider);

// a link to an element inside a slide shows that slide
function hashchange() {
  const el = location.hash && document.getElementById(location.hash.slice(1));
  el?.closest('b1-slider')?.slideTo(el.closest('.b1_slideshow > .-slider > *'));
}
addEventListener('DOMContentLoaded', hashchange);
addEventListener('hashchange', hashchange);
