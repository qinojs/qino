!function(){
'use strict';
if (window.cms_image2) return;


const InitializedSet = new WeakSet();

window.cms_image2 = {
    init: function(c1Img){
        // init once
        if (InitializedSet.has(c1Img)) return;
        InitializedSet.add(c1Img);

        let img = null;
        // add image
    	const noscript = c1Img.c1Find('>noscript');

		if (noscript) {
			// const html = noscript.textContent || noscript.innerHTML; // zzz
			// var img = c1.dom.fragment( html ).firstChild;
            const tpl = document.createElement('template');
            tpl.innerHTML = noscript.textContent;
            img = tpl.content.firstElementChild;
		}

		if (!img) { // sometimes immediate is to fast and noscript.innerHTML is not complete (firefox 71)
			//console.warn('immediate was too fast');
			requestAnimationFrame(function(){
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
    },
    bg:function(element){
        const src = element.getAttribute('data-cms-image2-bg');
        element.c1Image2_url = src;
        const preload = element.hasAttribute('data-preload') || element.hasAttribute('preload');
		if (preload) {
			onIntersecting({target:element, boundingClientRect:element.getBoundingClientRect() }) // trigger earlier but bcr is not performant
		}
        observer.observe(element);
    }
};

function onIntersecting(entry) {
    const img  = entry.target;
    const rect = entry.boundingClientRect;
	if (rect.width === 0 || rect.height === 0) return; // if event is fired but no dimensions
    const margin = 190; // must be smaller then rootMargin
    const partVisible = (rect.bottom > -margin && rect.top < window.innerHeight+margin) && (rect.right > -margin && rect.left < window.innerWidth+margin);
    if (!partVisible) return;
    observer.unobserve(img);


	// add Resize eventListener, to reovserve intersection
    c1UglyResize.add(img);
    if (!img.c1UgliResizeBoundEventListener) {
        img.c1UgliResizeBoundEventListener = function(){
            observer.observe(img); // re-observe on resize
        }.c1Debounce({min:150,max:2000});
	    img.addEventListener('c1UglyResize',img.c1UgliResizeBoundEventListener);
    }


    // load
    const dbf = new dbFileUrl(img.c1Image2_url);
    dbf.set('w', roundImgSize(rect.width));
    dbf.set('h', roundImgSize(rect.height));
    const src = dbf.toString();

    //if (src === img.__actualSrc) return;
    if (src === img.__futuerSrc) return;
    img.__futuerSrc = src;
    
    img.__abort?.();
    img.__abort = loadImage(src, function(done){
        
        img.__abort = null; // gc

        if (!done) return;
        if (img.__futuerSrc !== src) {
            console.log('should not happen as we have now abort(), but it happens...');
            return;
        }

        if (img.hasAttribute('data-cms-image2-bg')) {
            img.style.backgroundImage = 'url('+src+')';
        } else {
            img.src = src;
            //img.__actualSrc = src;
			img.removeAttribute('loading'); // some images have loading=lazy
        }
        requestAnimationFrame(()=>{
            img.parentNode.setAttribute('loaded','');
            img.parentNode.style.backgroundImage = 'none';
            // setTimeout(()=>{ // allfällige animation abwarten, problem:halbtransparente bilder
            //   img.parentNode.style.backgroundImage = 'none';
            // },400)
        })
    });

}
// listen
const observer = new IntersectionObserver((entries)=>entries.forEach(onIntersecting), {root:null, rootMargin:'150px', threshold:0});

// helper
function roundImgSize(v){
    const intervall = v > 400 ? 50 : 30;
    return Math.ceil(v/intervall) * intervall;
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
    c1UglyResize.add = function(el){
        latestEl = el;
        setTimeout(function(){ latestEl = null; },10); // not needed if if (src === img._latestSrc) return; check
        observer.observe(el);
    };
    const observer = new ResizeObserver(function(entries){
        entries.forEach(function(entry){
            if (latestEl === entry.target) return;
            entry.target.dispatchEvent(new CustomEvent('c1UglyResize'));
        });
    });
}();


}();


customElements.define('cms-image2', class CmsImage2 extends HTMLElement {
    connectedCallback() {
        if (this.hasAttribute('wait')) return;
        if (this.hasAttribute('data-preload')) console.warn('cms-image2: data-preload attribute is deprecated, use "preload"');
        cms_image2.init(this);
    }
});

c1.onElement('[data-cms-image2-bg]',{
	immediate:function(element){
        // console.warn('data-cms-image2-bg used?'); yes, used
		if (element.hasAttribute('wait')) return;
        if (this.hasAttribute('data-preload')) console.warn('cms-image2: data-preload attribute is deprecated, use "preload"');
		cms_image2.bg(element);
	}
});
