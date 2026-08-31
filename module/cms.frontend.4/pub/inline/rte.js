// Inline rich text editing: the u2 editor, configured for this CMS, plus the tools
// that only make sense here — CMS addresses, dbFile images, external media on paste.
import { editor, selectedElement } from '@qino/u2/js/rte/rte.js';
import '@qino/u2/js/rte/classes.js';
import '@qino/u2/js/rte/images.js';
import '@qino/u2/js/rte/source.js';
import '@qino/u2/js/rte/tables.js';
import '@qino/u2/js/rte/unstyle.js';
import { blockStyles } from '@qino/u2/js/rte/src/client/blocks.js';
import { linkEditor } from '@qino/u2/js/rte/src/client/link.js';
import '@qino/pub/Rte/helpers.mjs'; // getPossibleClasses, until the old editor is gone
import { api, ctx } from '@qino/pub/qino.js';

// scoped query helpers
const find    = (el, sel) => el.querySelector(':scope '+sel);
const findAll = (el, sel) => el.querySelectorAll(':scope '+sel);

/* Headings: this CMS offers all six. */
editor.add(blockStyles([
  { name: 'paragraph', label: 'Paragraph', selector: 'p', tag: 'p' },
  ...[1,2,3,4,5,6].map(n => ({ name: 'h'+n, label: 'Heading '+n, selector: 'h'+n, tag: 'h'+n })),
]));

/* Content classes come from the site's own stylesheets — a capitalised class name
   is the convention for "meant for the editor". The property is inherited, so one
   declaration reaches every field, and it also tells the sanitizer and the
   presentation cleanup which classes are content rather than decoration. */
const contentClasses = () => Object.keys(getPossibleClasses(null)).filter(cl => /^[A-Z]/.test(cl));
addEventListener('load', () =>
  document.documentElement.style.setProperty('--u2-rte-classes', contentClasses().join(', ')));

/* Links. What an address means is the CMS's business: a number is a page, a bare
   domain or mail address gets its scheme, and where a link opens follows from it. */
const URL_RE = /^[a-zA-Z0-9-]{2,999}\.[a-z0-9]{2,10}/;
const MAIL_RE = /^([a-zA-Z0-9_.-])+@(([a-zA-Z0-9-])+.)+([a-zA-Z0-9]{2,10})+$/;

const address = href => {
  if (href !== '' && !isNaN(href)) return 'cmspid://'+href;
  if (MAIL_RE.test(href)) return 'mailto:'+href;
  if (URL_RE.test(href)) return 'https://'+href;
  return href;
};

/** Wants a tab of its own: somewhere else on the web, or one of our files — a pdf
 *  or an image is not a page, and taking the reader off the site to show it loses
 *  where they were. */
const ownTab = href => {
  if (href.includes('/dbFile/')) return true;
  if (/^(cmspid|mailto|tel):/.test(href) || href[0] === '#') return false;
  try { return new URL(href, location.href).host !== location.host; } catch { return false; }
};

editor.add(linkEditor({
  fields: ['href'],
  // Where a link opens follows from where it goes: a page of this site stays in
  // the tab, anywhere else and every file gets its own. Nobody has to tick that.
  normalize(value) {
    if (!value) return null;
    const href = address(value.href);
    return ownTab(href) ? { href, rel: 'noopener', target: '_blank' } : { href };
  },
  // A new link on text that is already an address takes it; anything else is
  // looked up as a page title.
  async suggest(text) {
    text = text.trim();
    if (!text) return null;
    if (/^https?:\/\/\S+$/.test(text) || URL_RE.test(text) || MAIL_RE.test(text)) return { href: text };
    const [node] = await search(text);
    return node ? { href: node.value } : null;
  },
  // Typing offers the site's own pages and files, so neither a page id nor a file
  // path ever has to be typed out.
  complete: search,
}));

/** What a link can point at here: this site's pages and its files. The api renders
 *  each hit itself — title, kind, the path above it, a thumbnail for an image —
 *  and the form sanitizes that markup. */
async function search(q) {
  const [nodes, files] = await Promise.all([
    api.cms.nodes.get({ q }).catch(() => []),
    api.cms.files.get({ q }).catch(() => []),
  ]);
  return [
    ...nodes.map(node => ({ value: 'cmspid://'+node.value, html: node.html })),
    ...files.map(file => ({ value: ctx.appUrl+'dbFile/'+file.value+'/'+encodeURIComponent(file.text), html: file.html })),
  ];
}

/* dbFile images. The editor writes width and height attributes; the server is the
   one that scales the file, so the size has to reach the url as well. Both ways go
   through the existing qgResize event, which the drop and zoom tools also use. */
const dbImage = edit => {
  const el = selectedElement(edit, el => el.matches('img'));
  return el?.src.includes('dbFile/') ? el : null;
};
const sizes = {};
const measure = url => sizes[url] ??= new Promise(resolve => {
  const img = new Image();
  img.addEventListener('load', () => resolve([img.width, img.height]), { once: true });
  img.src = url;
});
const toOriginal = async img => {
  const url = img.getAttribute('src').replace(/\/(w|h|zoom|vpos|hpos|dpr)-[^\/]+/g, '');
  const [width, height] = await measure(url);
  img.setAttribute('src', url);
  img.style.width = '';
  img.style.maxWidth = '100%';
  img.style.height = 'auto';
  img.setAttribute('width',  width  / 2); // the server is told by cookie to deliver double resolution
  img.setAttribute('height', height / 2);
  img.dispatchEvent(new Event('qgResize', { bubbles: true }));
};

editor.add({
  name: 'cms.images',
  commands: () => ({
    imageFull: {
      transaction: false,
      enabled: edit => !!dbImage(edit),
      run: edit => { toOriginal(dbImage(edit)); },
    },
  }),
  attach({ surface }) {
    const controller = new AbortController();
    surface.addEventListener('u2-rte-change', () => {
      for (const img of surface.element.querySelectorAll('img[src*="dbFile/"]')) {
        const file = new dbFile(img);
        // the url spells the size w/h, the element width/height
        const same = (attr, part) => !img.hasAttribute(attr) || Number(img.getAttribute(attr)) === Number(file.get(part));
        if (!img.hasAttribute('width') && !img.hasAttribute('height')) continue;
        if (same('width', 'w') && same('height', 'h')) continue;
        img.dispatchEvent(new Event('qgResize', { bubbles: true }));
      }
    }, { signal: controller.signal });
    return { dispose: () => controller.abort() };
  },
  toolbar: [{ command: 'imageFull', label: 'Original image', text: '⤢' }],
});

const externMediaDialog = async function(txtEl,medias) {
  const pid = await cms.txtIdToPid( txtEl.getAttribute('cmstxt') );
  const dialog = document.createElement('dialog');
  dialog.innerHTML =
    '<form method=dialog style="display:flex; flex-flow:column; gap:1em">'+
      '<p style="margin:0">Which files do you want to copy to your server?</p>'+
      '<div class=-files style="display:flex; flex-flow:column"></div>'+
      '<menu style="display:flex; justify-content:flex-end; margin:0; padding:0">'+
        '<button value=done>done</button>'+
      '</menu>'+
    '</form>'+
    '<style>.cmsExtMediaHighlight {outline: 6px solid #fa0}</style>';
  const list = find(dialog, '.-files');
  for (const media of Object.values(medias)) {
    const label = c1.dom.el('<label><input type=checkbox checked> '+media.basename+'</label>');
    label.addEventListener('mouseover', ()=> media.els.forEach(el=>el.classList.add('cmsExtMediaHighlight')) );
    label.addEventListener('mouseleave',()=> media.els.forEach(el=>el.classList.remove('cmsExtMediaHighlight')) );
    find(label, 'input').addEventListener('change', e => media.checked = e.currentTarget.checked);
    list.append(label);
  }
  dialog.addEventListener('click', e => e.target === dialog && dialog.close()); // backdrop
  dialog.addEventListener('close', () => {
    if (dialog.returnValue === 'done') for (const [uri,media] of Object.entries(medias)) {
      if (!media.checked) { media.els.forEach(el=>el.classList.add('externMedia')); continue; }
      api.cms.node(pid).files.post({ file: uri }).then(v=>{
        if (!v.url) return;
        for (const el of media.els) el.setAttribute(el.hasAttribute('src')?'src':'href', v.url+'/'+media.basename);
        txtEl.dispatchEvent(new Event('input',{bubbles:true}));
        txtEl.focus();
      });
    }
    dialog.remove();
  });
  document.body.append(dialog);
  dialog.showModal();
}
const checkMedia = root => {
  const medias = {}; let has = false;
  for (const el of findAll(root, 'a, img')) {
    if (el.classList.contains('externMedia')) continue;
    for (const attr of ['src','href']) {
      if (!el.hasAttribute(attr)) continue;
      const uri = new URL(el[attr]);
      if (location.host === uri.host) continue;
      const ext = uri.pathname.replace(/.*\./,'');
      if (!ext) continue;
      if (el.tagName === 'IMG' || ['pdf','doc','xls','jpg','png','gif'].includes(ext)) {
        const media = medias[uri] ||= {els:[], basename:uri.pathname.replace(/.*\//,''), checked:true};
        media.els.push(el);
        has = true;
      }
    }
  }
  has && externMediaDialog(root,medias);
};
document.addEventListener('paste', e => {
  if (!e.target.contentEditable) return;
  const txtEl = e.target.closest('[cmstxt]');
  if (!txtEl) return;
  setTimeout(()=>checkMedia(txtEl));
});

/* dbfile */
document.addEventListener('qgResize',e=>{
  const el = e.target;
  if (!el.isContentEditable) return;
  if (el.tagName === 'IMG' && el.src.includes('dbFile/')) {
    // The editor states a size as width/height attributes, which an inline style
    // would override — so the attribute leads and the style follows it here.
    const width = Number(el.getAttribute('width')) || el.width;
    const height = Number(el.getAttribute('height')) || el.height;

    el.setAttribute('loading','lazy');
    el.style.setProperty('--shape-outside-url', 'url("'+el.getAttribute('src')+'")');

    el.style.maxWidth = '100%';
    el.style.width = width+'px';
    el.style.height = 'auto';
    new dbFile(el).set('w',width).set('h',height).set('max', 0);
    el.setAttribute('width',width);
    el.setAttribute('height',height);
    if (el.style.display === 'inline-block') el.style.display = '';

    el.removeAttribute('draggable');
    el.closest('[contenteditable]').dispatchEvent(new Event('input', {bubbles:true})); // save
  }
});

// dbclick zoomer
addEventListener('dblclick', e => {
  const img = e.target;
  if (img.isContentEditable && img.tagName === 'IMG' && img.src.includes('/dbFile')) {
    e.stopPropagation();
    e.preventDefault();

    const zoomImg = new Image();
    const clip = {};
    zoomImg.src = img.src.replace(/([a-z]+)-([^\/]*)\//g,function(match, name, value) {
      switch (name) {
        case 'w': case 'h': case 'vpos': case 'hpos': case 'zoom':
          clip[name] = parseFloat(value);
          return '';
        default: return match;
      }
    });
    zoomImg.onload = () => {
      const zoomer = new ImageZoomer(zoomImg);
      zoomer.activate();
      const change = () => {
        const vpos = zoomer.y / ( zoomer.img.height - zoomer.h ) || 0;
        const hpos = zoomer.x / ( zoomer.img.width  - zoomer.w ) || 0;
        new dbFile(img).set( 'vpos', vpos*100 ).set( 'hpos', hpos*100 ).set( 'zoom', zoomer.factor() );
        img.dispatchEvent(new Event('qgResize',{bubbles:true}));
      };
      zoomer.on('change',c1.debounce(change, 500));
      const pos = img.getBoundingClientRect();
      const left = pos.left + scrollX;
      const top  = pos.top  + scrollY;
      zoomer.canvas.style.cssText = 'outline:3px solid red; cursor:move; position:absolute; top:'+top+'px; left:'+left+'px';
      zoomer.setDimension( pos.width, pos.height );

      /* set clip */
      const f = clip.zoom || Math.min( zoomer.img.height/zoomer.ctx.height, zoomer.img.width/zoomer.ctx.width );
      zoomer.w = pos.width  * f;
      zoomer.h = pos.height * f;
      zoomer.x = (clip.hpos/100) * (zoomer.img.width  - zoomer.w ) || 0;
      zoomer.y = (clip.vpos/100) * (zoomer.img.height - zoomer.h ) || 0;

      zoomer.draw();

      const deactivate = () => {
        zoomer.canvas.remove();
        document.removeEventListener('mousedown', deactivate);
        change();
      };
      document.addEventListener('mousedown', deactivate);
    };
  }
});

class ImageZoomer {
  constructor(img) {
    this.x = 0;
    this.y = 0;
    this.w = 100;
    this.h = 100;
    this.f = 1;

    this.img = img;
    this.canvas = document.createElement('canvas');
    this.canvas.setAttribute('tabindex','0');
    this.ctx = this.canvas.getContext("2d");
    this.setDimension(img.width,img.height);
    document.body.append(this.canvas);
  }
  setDimension(w,h) {
    this.ctx.width = this.canvas.width = w;
    this.ctx.height = this.canvas.height = h;
  }
  factor() {
    return this.w / this.ctx.width;
  }
  activate() {
    this.canvas.addEventListener('wheel', e => {
      eventStop(e);
      const oldF = this.factor();
      let f = oldF * wheelIntervalToFaktor(e);
      f = Math.min( this.img.height/this.ctx.height, this.img.width/this.ctx.width,  f ); // limit
      f = Math.max(1,f);

      const offset = this.mouseOffsetCloserToCenter(e);

      // offset transformed to image
      this.x = oldF * offset.x + this.x;
      this.y = oldF * offset.y + this.y;

      this.w = this.ctx.width  * f;
      this.h = this.ctx.height * f;
      this.x -= this.w/2;
      this.y -= this.h/2;

      this.draw();
    });

    let mousePos = {};
    this.canvas.addEventListener('mousedown', e => {
      e.preventDefault();
      e.stopPropagation();
      mousePos = {x: e.pageX, y: e.pageY};
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    });
    const move = (e) => {
      const f = this.factor();
      const diff = {x: mousePos.x - e.pageX, y: mousePos.y - e.pageY};
      mousePos = {x: e.pageX, y: e.pageY};
      this.w = this.ctx.width  * f;
      this.h = this.ctx.height * f;
      this.x += diff.x;
      this.y += diff.y;
      this.draw();
    }
    function up() {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
    }
  }
  draw() {
    this.x = limit(this.x, 0, this.img.width  - this.w );
    this.y = limit(this.y, 0, this.img.height - this.h );
    this.ctx.clearRect(0, 0, this.ctx.width, this.ctx.height);
    this.ctx.drawImage(this.img, this.x, this.y, this.w, this.h, 0, 0, this.ctx.width, this.ctx.height);
    this.trigger('change');
  }
  mouseOffsetCloserToCenter(e) {
    // real offset on canvas
    const x = e.offsetX;
    const y = e.offsetY;
    return {
      x: ( x + 2*this.ctx.width  ) / 5, //(x+4*xhalbe durch 5)
      y: ( y + 2*this.ctx.height ) / 5
    };
  }
}
Object.assign(ImageZoomer.prototype, c1.Eventer);

/*******************************/
/* helpers *********************/
/*******************************/
function limit(number, min, max) {
  return Math.min(max, Math.max(number, min) );
}
let lastTime = 0;
function wheelIntervalToFaktor(e) {
  // intervall diff
  const time = e.timeStamp;
  let diff = time-lastTime;
  if (!e._eventChecked) {
    lastTime = time;
    e._eventChecked = true;
  }
  // faktor
  const MAX = 400;
  const MIN = 10;
  diff = limit(diff, MIN, MAX+MIN);
  let x = (diff - MIN) / MAX; // range from 1 to 0
  x = 1-x;
  x **= 3;
  x = 1-x;
  x = 0.7 + (0.3 * x); // range from 0.7 to 1.0;
  x = Math.min(x, 0.998);

  x = e.deltaY > 0 ? x : 1/x; // up or down?
  return x;
}
function eventStop(e) {
  e.stopPropagation();
  e.preventDefault();
}
