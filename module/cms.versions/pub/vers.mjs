//import '../../cms.frontend.2/pub/js/contextMenu.mjs';
import { apt, ctx } from '../../core/pub/js/qino.js';

// scoped query helpers
const find    = (el, sel) => el.querySelector(':scope '+sel);
const findAll = (el, sel) => el.querySelectorAll(':scope '+sel);

const sysURL = ctx.sysURL;
const Page = globalThis.qino?.cms?.nodeId;
const cmsFrontend = globalThis.cmsFrontend || 'cms.frontend.2';

const body = document.body;
const htmlEl = document.documentElement;

function panelEl(selector) {
  return (document.querySelector('qino-cms')?.shadowRoot || document).querySelector(selector);
}

const CmsVersViewer = function(){
  this.container = c1.dom.fragment(`
    <div id=qgCms_vers tabindex=-1 class=qgCMS popover=manual>
      <div class=-preview></div>
      <div class=-control>
        <div class=-head>Verlauf</div>
        <ul class=-list></ul>
      </div>
      <style id=x>${css()}</style>
    </div>`
  ).firstElementChild;
  this.preview = find(this.container, '.-preview');
  this.iframe1 = document.createElement('iframe');
  this.iframe2 = document.createElement('iframe');
  this.iframe1.sandbox = this.iframe2.sandbox = 'allow-same-origin allow-scripts';
  this.preview.append(this.iframe1, this.iframe2);
  find(this.container, '.-control > .-head').addEventListener('click', ()=>{
    this.hide();
  });
  this.keydownListener = e=>{
    if (e.key === 'Escape') this.hide();
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const active = find(this.container, '.-list > li.-active');
    const next = active.nextElementSibling;
    const prev = active.previousElementSibling;
    if (e.key === 'ArrowDown' && next) this.load(next.getAttribute('v'));
    if (e.key === 'ArrowUp' && prev) this.load(prev.getAttribute('v'));
  };
  this.container.addEventListener('keydown',this.keydownListener);
};
CmsVersViewer.prototype = {
  show: function(pid){
    this.pid = pid;
    this.initialScrolltop = htmlEl.scrollTop || body.scrollTop;
    body.append(this.container);
    if (!this.container.matches(':popover-open')) this.container.showPopover();
    if (innerWidth < 900) {
      this.container.webkitRequestFullscreen?.();
      this.container.requestFullscreen?.();
    }
    this.container.focus()
    this.container.style.pointerEvents = 'none';
    setTimeout(()=> { this.container.style.pointerEvents = ''; } ,900)
    body.style.overflow = htmlEl.style.overflow = 'hidden';
    apt['cms.versions'].node(pid).get().then(rows=>{
      let activeRow = null;
      const list = find(this.container, '.-list');
      list.innerHTML = '';
      rows.forEach(row=>{
        const li = c1.dom.fragment(
          `<li v=${row.vers}><div class=-date>${relativeDate(row.time)}</div><div class=-usr>${row.usr}</div>`
        ).firstElementChild;
        find(li, '.-date').title = exactDate.format(row.time*1000);
        li.addEventListener('mouseover',()=>{
          if (activeRow === row.vers) return;
          activeRow = row.vers;
          this.load(row.vers);
        });
        list.prepend(li);
      });
      rows.length && this.load(rows.at(-1).vers);
    });
  },
  hide: function(){
    this.container.remove();
    body.style.overflow = htmlEl.style.overflow = '';
    htmlEl.scrollTop = body.scrollTop = this.initialScrolltop;
  },
  load: c1.debounce(function(vers){
    vers = parseInt(vers);
    let scrollTop = this.initialScrolltop;
    if (this.activeIframe) {
      const doc = this.activeIframe.contentWindow.document;
      if (doc.body) scrollTop = doc.documentElement.scrollTop || doc.body.scrollTop;
      this.activeIframe.style.opacity = 1;
    }
    this.activeIframe = this.activeIframe === this.iframe1 ? this.iframe2 : this.iframe1;

    const src = new URL(location.href);
    src.hash = '';
    src.searchParams.append('cms_versions_log',vers+1)
    src.searchParams.append('cms_versions_page',this.pid)
    src.searchParams.append('cms_noFrontend','1');
    this.activeIframe.src = src;

    this.activeIframe.style.opacity = 0;

    this.preview.classList.add('-loading');

    for (const li of findAll(this.container, '.-list > li')) li.classList.remove('-active');
    const li = find(this.container, `.-list > li[v="${vers}"]`);
    li.classList.add('-active','-loading');

    this.activeIframe.onload = ()=>{
      this.preview.classList.remove('-loading');
      this.iframe1.style.zIndex = this.activeIframe === this.iframe1 ? 1 : 0;
      this.iframe2.style.zIndex = this.activeIframe === this.iframe2 ? 1 : 0;
      this.activeIframe.style.opacity = 1;
      const doc = this.activeIframe.contentWindow.document;
      doc.addEventListener('keydown', this.keydownListener);
      const ready = ()=>{
        if (!doc.body) return;
        // force instant scroll on every element/container (page sets scroll-behavior:smooth)
        const style = doc.createElement('style');
        style.textContent = '*{scroll-behavior:auto !important}';
        doc.head.append(style);
        doc.documentElement.scrollTop = doc.body.scrollTop = scrollTop;
        const els = doc.querySelectorAll('[qcms-id="'+this.pid+'"]');
        let el;
        for (el of els) el.style.outline = '3px solid red';
        el?.scrollIntoView();
      }
      document.readyState === 'complete' ? ready() : doc.addEventListener('DOMContentLoaded',ready);
      li.classList.remove('-loading');
    };
    this.trigger('before-load', {vers});
  }, {min:200, max:500}),
};
Object.assign(CmsVersViewer.prototype, c1.Eventer);

/* create Viewer */
const Viewer = new CmsVersViewer();

/* more */
const more = c1.dom.fragment(`
  <div class=-more>
    <button class=-compareActive>Mit Aktuell vergleichen</button>
    <button class=-reactivate>Stand wiederherstellen</button>
    <div class=-txt></div>
  </div>`).firstElementChild;
const pointer = c1.dom.fragment('<i class=-pointer></i>').firstChild;
find(Viewer.container, '.-control').append(more, pointer);
Viewer.on('before-load',function(e){
  const li = find(this.container, `.-list > li[v="${e.vers}"]`);
  const pos = li.getBoundingClientRect();
  let top = pos.top;
  pointer.style.transform = `translateY(${top}px) rotate(45deg)`;
  top = Math.min(top, innerHeight - 260);
  more.style.transform = `translateY(${top}px)`;
  find(more, '.-txt').innerHTML = 'please wait...';
  apt['cms.versions'].log(e.vers).get().then(data => {
    const date = new Date(data.time * 1000);
    let str = '';
    for (const msg of data.messages) {
      str += `<div style="padding:5px 0 5px 8px; margin:8px 0; border-left:1px solid #fff; background:#555">${msg}</div>`;
    }
    str +=
      `<div class=-date>${exactDate.format(date)}</div>` +
      `<div class=-usr>${data.usr}</div>` +
      `<div class=-device title="${data.user_agent}">${data.browser} | ${data.ip}</div>`;
    find(more, '.-txt').innerHTML = str;
  });
  find(more, '.-reactivate').onclick = () => {
    body.style.opacity = 0.3;
    apt['cms.versions']['publish-node'].post({ pid: Viewer.pid, options: {fromLog:e.vers+1} }).then(() => {
      location.href = location.href.replace(/#.*$/,'');
    });
  };
  find(more, '.-compareActive').onclick = async () => {
    const { CmsVersComparer } = await import('./comparer.mjs');
    CmsVersComparer.compare(Viewer.pid, {
      fromLog: e.vers+1,
      fromText: find(li, '.-date').innerHTML,
      toText: 'aktuell',
      accept(){ find(more, '.-reactivate').onclick(); },
      acceptText:'Stand wiederherstellen',
    });
  };
});
more.addEventListener('mouseover', e => {
  const mark = e.target.getAttribute('mark');
  if (!mark) return;
  const all = Viewer.activeIframe.contentWindow.document.querySelectorAll(mark);
  for (const el of all) {
    el.style.outline = '10px dotted red';
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    Viewer.activeIframe.contentWindow.scrollBy(-100,-100)
  }
});

/* ui */
document.addEventListener('keydown',e=>{
  const target = e.composedPath()[0]; // real element even inside shadow DOM (e.target would be the host)
  if (target.getRootNode() !== document) return; // from shadow DOM = a component (tree/panel/…) owns the key
  if (target.isContentEditable || target.form !== undefined) return; // inputs/contenteditable in the light DOM (page content)
  if (e.shiftKey || e.metaKey || e.altKey || e.ctrlKey) return;
  if (e.code === 'KeyH') {
    Viewer.show(Page);
    e.preventDefault();
  }
});

cms.contextMenueContent.addItem('Verlauf', {
  icon: sysURL+cmsFrontend+'/pub/img/undo.svg',
  selector: '[qcms-edit], #qgCmsContPosMenu',
  onshow() {
    this.activePid = cms.contPos.active.pid;
    this.disabled = !cms.contPos.active.el.hasAttribute('qcms-edit');
  },
  onclick() {
    Viewer.show(this.activePid);
  }
});

// frontend integration
const sidebarItem = c1.dom.fragment(`
  <div class=-item itemid=history>
    <div class=-title>
      <div class=-text>Verlauf</div>
    </div>
  </div>`).firstElementChild;
panelEl('#qgCmsFrontend1 > .-sidebar > [itemid="more"], #panel > .-sidebar > [itemid="more"]')?.after(sidebarItem)
sidebarItem.addEventListener('mousedown', e=>{
  e.stopPropagation();
  Viewer.show(Page)
});


const locale = document.documentElement.lang || navigator.language;
const relativeFormat = new Intl.RelativeTimeFormat(locale, {numeric:'auto'});
const exactDate = new Intl.DateTimeFormat(locale, {dateStyle:'medium', timeStyle:'medium'});
const relativeUnits = [[60, 'second'], [60, 'minute'], [24, 'hour'], [30, 'day'], [12, 'month'], [Infinity, 'year']];
function relativeDate(timestamp) {
  let value = timestamp - Date.now()/1000;
  for (const [limit, unit] of relativeUnits) {
    if (Math.abs(value) < limit) return relativeFormat.format(Math.round(value), unit);
    value /= limit;
  }
}

function css(){
  return `
#qgCms_vers {
  display:flex;
  position:fixed;
  inset:0;
  width:auto; height:auto;       /* override [popover] UA fit-content */
  margin:0; border:0; padding:0; /* reset [popover] UA box */
  overflow:visible;              /* reset [popover] UA overflow:auto */
  background:#fff;

  > .-control {
    position:relative;
    display:flex;
    flex-flow:column;
    border:1px solid var(--cms-light);
    border-width:0 1px;
    flex:0 1 auto;
    min-width:160px;
  }
  .-head {
    -webkit-tap-highlight-color:rgba(0, 0, 0, 0);
    background-color:rgb(60, 60, 60);
    color:#fff;
    cursor:pointer;
    font-size:16px;
    padding:12.8px 19.2px 11.2px 10px;

    &:after {
      font-family:qg_cms;
      content:"\\e902";
      position:absolute;
      right:.8em;
      border-left:1px solid;
      padding-left:10px;
      transition:opacity .2s;
    }
  }
  .-list {
    flex:1 1 auto;
    overflow:auto;
    display:block;
    margin:0;
    padding:0;

    > li {
      display:block;
      background:#fff;
      border-top:1px solid var(--cms-light);
      padding:5px 10px;
      position:relative;

      &:hover, &.-active { color:var(--cms-color); }
      &.-loading:after {
        content:"|";
        position:absolute;
        color:#000;
        top:5px;
        right:10px;
        animation:spin .5s linear infinite;
      }
    }
    .-date { font-size:1.2em; }
    .-usr {
      white-space:nowrap;
      overflow:hidden;
      text-overflow:ellipsis;
      width:140px;
    }
  }
  > .-preview {
    flex:100 1 auto;
    position:relative;
    background:#000;
    z-index:0;

    &:before {
      content:" ";
      position:absolute;
      inset:0 0 auto;
      height:3px;
      background-color:white;
      transform:translateX(-100%);
      transition:transform .5s linear;
      will-change:transform;
    }
    &.-loading:before { transform:translateX(0); }
    > iframe {
      position:absolute;
      inset:3px 0 0;
      width:100%;
      height:100%;
      border:0;
      transition:opacity .4s linear;
      background-color:#fff;
      will-change:opacity;
    }
  }
  .-more {
    position:absolute;
    right:100%;
    top:0;
    padding:20px;
    background:var(--cms-dark);
    color:#fff;
    line-height:1.8;
    min-height:80px;
    min-width:220px;
    z-index:4;
    opacity:0;
    visibility:hidden;
    transition:opacity .3s, visibility .3s;
    will-change:transform, opacity;

    > button {
      margin-bottom:8px;
      width:100%;

      &:hover {
        color:var(--cms-dark);
        background:#fff;
      }
    }
    .-txt {
      max-height:170px;
      overflow:auto;
    }
    .-date:before, .-usr:before, .-device:before {
      font-family:qg_cms;
      padding-right:7px;
    }
    .-date:before { content:"\\e901"; }
    .-usr:before { content:"\\e600"; }
    .-device:before { content:"\\e601"; }
  }
  .-pointer {
    position:absolute;
    top:15px;
    left:-6px;
    width:12px;
    height:12px;
    background:var(--cms-dark);
    transform:rotate(45deg);
    opacity:0;
    transition:opacity .3s, visibility .3s;
    will-change:transform, opacity;
  }
  .-control:hover {
    > .-more, > .-pointer {
      opacity:1;
      visibility:visible;
    }
  }
}
@keyframes spin { to { transform:rotate(360deg); } }
`;
}
