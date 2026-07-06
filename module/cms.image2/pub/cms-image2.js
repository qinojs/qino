!function(){
  'use strict';
  if (globalThis.cms_image2) return;

  const InitializedSet = new WeakSet();

  globalThis.cms_image2 = {
    init(c1Img){
      // init once
      if (InitializedSet.has(c1Img)) return;
      InitializedSet.add(c1Img);

      let img = null;
      // add image
      const noscript = c1Img.querySelector(':scope>noscript');

      if (noscript) {
        const tpl = document.createElement('template');
        tpl.innerHTML = noscript.textContent;
        img = tpl.content.firstElementChild;
      }

      if (!img) { // sometimes immediate is to fast and noscript.innerHTML is not complete (firefox 71)
      //console.warn('immediate was too fast');
        requestAnimationFrame(() => {
          InitializedSet.delete(c1Img);
          cms_image2.init(c1Img);
        });
        return;
      }

      img.c1Image2_url = img.src;
      img.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAP///////yH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
      //preview
      c1Img.prepend(img);

      const preload = c1Img.hasAttribute('data-preload') || c1Img.hasAttribute('preload');
      if (preload) {
        onIntersecting({target:img, boundingClientRect:img.getBoundingClientRect() }) // trigger earlier but getBoundingClientRect is not performant
      }
      observer.observe(img);
    }
  };

  function onIntersecting(entry) {
    const img  = entry.target;
    const rect = entry.boundingClientRect;
    if (rect.width === 0 || rect.height === 0) return; // if event is fired but no dimensions
    const margin = 190; // must be smaller then rootMargin
    const partVisible = (rect.bottom > -margin && rect.top < innerHeight+margin) && (rect.right > -margin && rect.left < innerWidth+margin);
    if (!partVisible) return;
    observer.unobserve(img);


    // add Resize eventListener, to reovserve intersection
    c1UglyResize.add(img);
    if (!img.c1UgliResizeBoundEventListener) {
      img.c1UgliResizeBoundEventListener = debounce(() => {
        observer.observe(img); // re-observe on resize
      }, 150, 2000);
      img.addEventListener('c1UglyResize',img.c1UgliResizeBoundEventListener);
    }


    // load – round in css px; dbFileSetSize adds dpr so the server scales to physical px
    const src = dbFileSetSize(img.c1Image2_url, roundImgSize(rect.width), roundImgSize(rect.height));

    //if (src === img.__actualSrc) return;
    if (src === img.__futuerSrc) return;
    img.__futuerSrc = src;

    img.__abort?.();
    img.__abort = loadImage(src, (done) => {

      img.__abort = null; // gc

      if (!done) return;
      if (img.__futuerSrc !== src) {
        console.log('should not happen as we have now abort(), but it happens...');
        return;
      }

      img.src = src;
      //img.__actualSrc = src;
      img.removeAttribute('loading'); // some images have loading=lazy
      requestAnimationFrame(()=>{
        img.parentNode.setAttribute('loaded','');
        img.parentNode.style.backgroundImage = 'none';
        // setTimeout(()=>{ // wait for possible animation, problem: semi-transparent images
        //   img.parentNode.style.backgroundImage = 'none';
        // },400)
      })
    });

  }
  // listen
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) onIntersecting(entry);
  }, {root:null, rootMargin:'150px', threshold:0});

  // helper
  function roundImgSize(v){
    const intervall = v > 400 ? 50 : 30;
    return Math.ceil(v/intervall) * intervall;
  }
  // run after `min`ms idle, but at latest `max`ms after the first call
  function debounce(fn, min, max){
    let tMin, tMax, self, args;
    function run(){ clearTimeout(tMin); clearTimeout(tMax); tMax = 0; fn.apply(self, args); }
    return function(){
      self = this; args = arguments;
      clearTimeout(tMin);
      tMin = setTimeout(run, min);
      tMax ||= setTimeout(run, max);
    };
  }
  function loadImage(url, cb) {
    const img = new Image();
    let aborted = false;

    img.fetchPriority = 'high';
    img.decoding = 'async';

    img.onload = () => cb(aborted ? false : img)
    img.onerror = () => cb(false);
    img.src = url; // todo await img.decode() ?
    return () => {
      aborted = true;
      img.src = ''; // Stoppt den Download
    }
  }

  // uglyResize
  const c1UglyResize = {};
  !function(){
    //window.c1UglyResize = {};

    let latestEl = null; // prevent (chrome?) from dispatch imediatly on observe
    c1UglyResize.add = (el) => {
      latestEl = el;
      setTimeout(() => { latestEl = null; }, 10); // not needed if if (src === img._latestSrc) return; check
      observer.observe(el);
    };
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (latestEl === entry.target) continue;
        entry.target.dispatchEvent(new CustomEvent('c1UglyResize'));
      }
    });
  }();


  function dbFileSetSize(url, w, h) {
    const m = url.match(/(.*dbFile\/([^/]+))((?:\/[^/]+)*?)\/([^/]+)$/);
    if (!m) return url;
    const params = Object.fromEntries((m[3].match(/\/[^/]+/g) ?? []).map(s => { const [k,...rest] = s.slice(1).split('-'); return [k, rest.length ? rest.join('-') : true]; }));
    params.w = w;
    params.h = h;
    params.dpr = Math.min(devicePixelRatio || 1, 2); // hi-dpi: physical px (capped 2×), explicit so a dpr cookie can't override
    return m[1] + Object.entries(params).map(([k,v]) => v === true ? `/${k}` : `/${k}-${v}`).join('') + '/' + m[4];
  }

}();


customElements.define('cms-image2', class CmsImage2 extends HTMLElement {
  connectedCallback() {
    if (this.hasAttribute('wait')) return;
    cms_image2.init(this);
  }
});
