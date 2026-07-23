import { ctx } from '../../core/pub/js/qino.js';

const { appURL } = ctx;
const Page = globalThis.qino?.cms?.nodeId;
let div, iframe1, iframe2, pid, view1;

const frameSrc = (space, log) => `${appURL}?cmspid=${Page}&cms_versions_space=${space}&cms_versions_log=${log}&cms_versions_page=${pid}&cms_noFrontend=1`;

export const CmsVersComparer = {
  _ensure(){
    if (div) return;
    const html = `
        <div id=qgCmsVersionComparer class=qgCMS popover=manual>
            <style>${css}</style>
            <div class=-tools>
                <div style="flex:1 0 12.5rem">
                    <button class=-mode-side>Switch view</button>
                    <button class=-diffs>Show differences</button>
                </div>
                <div style="flex:auto; display:flex; align-items:center; justify-content:center">
                    <span class=-toText style="flex:1 0 1.875rem; text-align:right">Live</span>
                    &nbsp;&nbsp; <input class=-fade min=0 max=1 step=any type=range><span class=-splitter></span> &nbsp;&nbsp;
                    <span class=-fromText style="flex:1 0 1.875rem"> &nbsp; Draft</span>
                </div>
                <div style="flex:1 0 12.5rem; text-align:right">
                    <button class=-accept>publish</button>
                    <button class=-close>close</button>
                </div>
            </div>
            <div class=-views>
                <div class=-v2><iframe class=-i2></iframe></div>
                <div class=-v1><iframe class=-i1></iframe></div>
            </div>
        </div>`;
    div = c1.dom.fragment(html).firstElementChild;
    iframe1 = div.querySelector('.-i1');
    iframe2 = div.querySelector('.-i2');
    view1   = div.querySelector('.-v1');
    div.querySelector('.-fade').addEventListener('input', e => {
      view1.style.opacity = e.target.value;
    });
    div.querySelector('.-mode-side').addEventListener('click', () => {
      const has = div.classList.toggle('-Mode-side');
      has && div.classList.remove('-Diffs');
    });
    div.querySelector('.-diffs').addEventListener('click', () => div.classList.toggle('-Diffs'));
    div.querySelector('.-close').addEventListener('click', () => this.close());

    function initFrame(){
      const other = this === iframe1 ? iframe2 : iframe1;
      const win = this.contentWindow;
      const doc1 = win.document;

      // scrollSync
      import('../../core/pub/js/c1/scrollSync.mjs').then(() => {
        // sync scroll
        c1.scrollSync.syncWindows(win, other.contentWindow);
        // sync clicks
        win.addEventListener('click', e => {
          if (e.c1Synced) return;
          const selector = c1.scrollSync.getSelector(e.target);
          const otherEl = other.contentWindow.document.querySelector(selector);
          const event = new MouseEvent('click', { view: globalThis, bubbles: true, cancelable: true });
          event.c1Synced = true;
          otherEl.dispatchEvent(event);
        }, true);
      });

      // mousemove  => opacity
      doc1.addEventListener('mousemove', e => {
        const opacity = e.clientX / win.innerWidth;
        div.querySelector('.-fade').value = opacity;
        view1.style.opacity = opacity;
      });
      const prevent = e => { e.preventDefault(); e.stopPropagation(); };
      doc1.addEventListener('mousedown', prevent);
      doc1.addEventListener('click', prevent);
      doc1.addEventListener('touchstart', prevent);
    }
    iframe1.addEventListener('load',initFrame);
    iframe2.addEventListener('load',initFrame);
  },
  keyListener(e){
    e.key === 'Escape' && CmsVersComparer.close();
  },
  compare(page_id, options) {
    this._ensure();
    addEventListener('keydown',this.keyListener);
    pid = page_id;
    options = {fromSpace:'active', fromLog:0, toSpace:'active', toLog:0, fromText:'Draft', toText:'Live', accept:null, acceptText:'Apply', ...options};
    // accept function
    const acceptEl = div.querySelector('.-accept');
    acceptEl.style.display = options.accept ? 'inline-block' : 'none';
    if (options.accept) {
      acceptEl.onclick   = options.accept;
      acceptEl.innerHTML = options.acceptText;
    }
    div.querySelector('.-fromText').innerHTML = options.fromText;
    div.querySelector('.-toText').innerHTML   = options.toText;
    this.setMain  (options.fromSpace, options.fromLog);
    this.setSecond(options.toSpace,   options.toLog);
    document.body.append(div);
    if (!div.matches(':popover-open')) div.showPopover();
  },
  close(){
    removeEventListener('keydown',this.keyListener);
    div.remove();
  },
  setMain(space, log)   { iframe1.src = frameSrc(space, log); },
  setSecond(space, log) { iframe2.src = frameSrc(space, log); }
};

const css = `
#qgCmsVersionComparer {
    position:fixed;
    inset:0;
    width:auto; height:auto;
    margin:0; border:0; padding:0;
    xoverflow:visible;
    background:#fff;
    display:flex;
    flex-flow:column;

    .-tools {
        display:flex;
        border-bottom:2px solid #000;
        > * { margin:10px; }
    }
    .-views {
        display:flex;
        position:relative;
        flex:auto;
        > div {
            position:absolute;
            inset:0;
            background:#fff;
            flex:auto;
        }
    }
    .-v1 { opacity:.5; }
    iframe {
        border:none;
        position:absolute;
        inset:0;
        width:100%;
        height:100%;
        box-sizing:border-box;
    }
    &.-Mode-side {
        .-views > div { position:relative; opacity:1 !important; }
        .-diffs    { display:none; }
        .-fade     { display:none; }
        .-splitter { display:inline-block; height:2em; border-left:2px solid #000; }
        .-i1 { border-left:1px solid #000; }
        .-i2 { border-right:1px solid #000; }
    }
    &.-Diffs {
        .-views { filter:invert(100%); }
        .-views > .-v1 { mix-blend-mode:difference; opacity:1 !important; }
        .-fade { display:none; }
    }
}`;
