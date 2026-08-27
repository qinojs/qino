// scoped query helpers
import './Rte.ui.mjs';
import {TableHandles} from '../c1/tableHandles.mjs';

const find    = (el, sel) => el.querySelector(':scope '+sel);
const findAll = (el, sel) => el.querySelectorAll(':scope '+sel);
const unwrap  = el => el.replaceWith(...el.childNodes); // remove element, keep its children
/*
let x = my.setItem('Bold',
  {
    shortcut:'l'
  }
);
x.addEventListener('mousedown', function() {
  Rte.modifySelection(function(els) {
    let first = $(els[1]||els[0]);
    let act = first.hasClass('SmallText') ? 'removeClass' : 'addClass';
    for (let i = els.length, el; el = els[--i];) {
      $(el)[act]('SmallText');
    }
  });
});
*/

const BLOCKLESS_ELEMENTS = {
  P:1,H1:1,H2:1,H3:1,H4:1,H5:1,H6:1,
  SPAN:1,BUTTON:1,B:1,I:1,STRONG:1,LABEL:1,A:1,
};

Rte.ui.setItem('Bold',           {cmd:'bold',    shortcut:'b', xenable:':not(img)'} );
Rte.ui.setItem('Italic',         {cmd:'italic',    shortcut:'i', xenable:':not(img)'} );
Rte.ui.setItem('Insertunorderedlist',  {cmd:'insertunorderedlist',shortcut:'8', enable(){ return !BLOCKLESS_ELEMENTS[Rte.active.tagName]; } });
Rte.ui.setItem('Insertorderedlist',    {cmd:'insertorderedlist',shortcut:'9', enable(){ return !BLOCKLESS_ELEMENTS[Rte.active.tagName]; } });
Rte.ui.setItem('Underline',       {cmd:'underline',  shortcut:'u', xenable:':not(img)'});
Rte.ui.setItem('Undo',           {cmd:'undo',  check:false});
Rte.ui.setItem('Redo',           {cmd:'redo',  check:false});
Rte.ui.setItem('Unlink',         {cmd:'unlink',  check:false});
Rte.ui.setItem('Hr',           {cmd:'inserthorizontalrule', check:false, enable(){ return !BLOCKLESS_ELEMENTS[Rte.active.tagName]; } });
Rte.ui.setItem('Strikethrough',     {cmd:'strikethrough', xenable:':not(img)'});

/* Headings */
{
  const opts = Rte.ui.setSelect('Format',{
    click(e) {
      const tag = e.target.getAttribute('value');
      tag && qgExecCommand('formatblock',false,tag);
      const stat = qgQueryCommandValue('formatblock');
      for (const el of opts.children) {
        el.className = el.tagName.toLowerCase()===stat ? '-selected' : '';
      }
    },
    check() {
      const stat = qgQueryCommandValue('formatblock');
      opts.previousElementSibling.innerHTML = Rte.element ? stat : 'Format';
    },
    enable() {
      return !BLOCKLESS_ELEMENTS[Rte.active.tagName];
    }
  });
  opts.innerHTML =
  '<p  value=p >Paragraph</p>'+
  '<h1 value=h1>Heading 1</h1>'+
  '<h2 value=h2>Heading 2</h2>'+
  '<h3 value=h3>Heading 3</h3>'+
  '<h4 value=h4>Heading 4</h4>'+
  '<h5 value=h5>Heading 5</h5>'+
  '<h6 value=h6>Heading 6</h6>'
}
/* CSS classes */
{
  const useClass = cl => /^[A-Z]/.test(cl);
  let hasClasses; /* check if this-handle is used */
  const check = c1.debounce(el => {
    const classes = getPossibleClasses(el);
    for (const cl of Object.keys(classes)) {
      hasClasses ||= useClass(cl);
    }
    sopts.parentElement.style.display = hasClasses ? '' : 'none';
  }, 150);

  const sopts = Rte.ui.setSelect('Style', {
    check() {
      check();
      const classes = Rte.element?.className?.split(' ').filter(useClass).join(' ') || 'Style';
      sopts.previousElementSibling.innerHTML = classes;
    },
    click() {
      sopts.innerHTML = '';
      let el = qgSelection.isElement() || getSelection().isCollapsed ? Rte.element : null;
      // if (el === Rte.active) return;
      const classes = getPossibleClasses(el);
      for (const sty of Object.keys(classes)) {
        if (!useClass(sty)) return;
        const has = el?.classList?.contains(sty);
        const d = c1.dom.el('<div class="'+sty+'">'+sty+'</div>');
        sopts.append(d);
        has && d.classList.add('-selected');
        d.onmousedown = () => {
          Rte.manipulate(()=>{
            el ||= qgSelection.surroundContents(document.createElement('span'));
            el.classList.toggle(sty, !has);
          });
        };
        // d.css({
        //   fontSize:parseInt(d.css('fontSize')).limit(9,18),
        //   margin:parseInt(d.css('margin')).limit(0,4),
        //   padding:parseInt(d.css('padding')).limit(0,4),
        //   letterSpacing:parseInt(d.css('letterSpacing')).limit(0,11),
        //   borderWidth:parseInt(d.css('borderWidth')).limit(0,4)
        // });
      }
    }
  });
}

/* show invisibles *
{
  function replaceContents(node){
    for (const el of node.childNodes) replaceNode(el);
  }
  function replaceNode(node) {
    if (node.nodeType === 3) { // text-nodes
      let offset = 0;
      for (const char of node.data) {
        if (char === '\xa0') {  // nbsp
          //var x = node.splitText(offset);
        }
        ++offset;
      }
    } else {
      replaceContents(node);
    }
  }
  Rte.ui.setItem('ShowInvisibleChars', {
    click(e) {
      let root = Rte.active;
      replaceContents(root);
    }
    ,shortcut:'space'
  });
}
/* clean / remove format */
{
  const removeTags = ['FONT','O:P','SDFIELD','SPAN'].reduce((obj, item)=>{ obj[item]=1; return obj; }, {});
  const cleanNode = node => {
    if (!node) return;
    cleanContents(node);
    node.nodeType === Node.COMMENT_NODE && node.remove();
    if (node.nodeType === Node.ELEMENT_NODE) {
      if (!Rte.active.contains(node)) return;
      node.removeAttribute('style');
      node.removeAttribute('class');
      node.removeAttribute('align');
      node.removeAttribute('valign');
      node.removeAttribute('border');
      node.removeAttribute('cellpadding');
      node.removeAttribute('cellspacing');
      node.removeAttribute('bgcolor');
      removeTags[node.tagName] && unwrap(node);
      if (node.tagName !== 'IMG') {
        node.removeAttribute('width');
        node.removeAttribute('height');
      }
    }
  }
  const cleanContents = node => {
    if (node.childNodes) for (const child of node.childNodes) cleanNode(child);
  }
  Rte.ui.setItem('Removeformat', {
    click(e) {
      const root = e.ctrlKey ? Rte.element : Rte.active;
      cleanContents(root);
    }
    ,shortcut:'space'
  });
}
{ /* code */
  const wrapper = c1.dom.el(
    '<div id=qgRteHtml>'+
      '<textarea spellcheck=false class=c1Rst></textarea>'+
      '<style>'+
      '  #qgRteHtml { opacity:1; transform:opacity .5s; position:fixed; z-index:2000; border:2px solid black; top:40%; left:1%; bottom:1%; right:1%; background:#fff; color:#000; margin:auto; box-shadow:0 0 20px} '+
      '  #qgRteHtml > textarea { position:absolute; inset:0; width:100%; height:100%; font:11px monospace; } '+
      '  #qgRteHtml.-Invisible { opacity:.1; } '+
      '  #qgRteHtml:hover { opacity:1; } '+
      '</style>'+
    '</div>'
  );


  let tO = null;
  const makeInvisible = () => {
    clearTimeout(tO);
    wrapper.classList.remove('-Invisible');
    tO = setTimeout(()=>{
      wrapper.classList.add('-Invisible');
    },700)
  }
  wrapper.addEventListener('keydown', makeInvisible);
  wrapper.addEventListener('mousemove', makeInvisible);

  const html = wrapper.firstChild;
  const el = Rte.ui.setItem('Code', {
    click() {
      const el = Rte.active;
      const sel = getSelection();
      let code;
      if (sel.rangeCount > 0) {
        const range = sel.getRangeAt(0);
        const startTextNode = document.createTextNode('marker_start_so9df8as0f0');
        const endTextNode   = document.createTextNode('marker_end_laseg08a0egga');
        let tmpRange = range.cloneRange();
        tmpRange.collapse(false);
        tmpRange.insertNode(endTextNode);
        tmpRange = range.cloneRange();
        tmpRange.collapse(true);
        tmpRange.insertNode(startTextNode);
        code = domCodeIndent(el.innerHTML);

        startTextNode.remove();
        endTextNode.remove();

        const start = code.indexOf('marker_start_so9df8as0f0');
        code = code.replace('marker_start_so9df8as0f0','');
        const end = code.indexOf('marker_end_laseg08a0egga');
        code = code.replace('marker_end_laseg08a0egga','');

        const brsTotal = (code.match(/\n/g)||[]).length;
        const brs    = brsTotal && (code.slice(0,start).match(/\n/g)||[]).length;

        setTimeout(()=>{
          html.focus();

          const y = parseInt((html.scrollHeight / brsTotal)*brs - 250);
          brs && (html.scrollTop = y);

          html.setSelectionRange(start, end);
        },10);
      } else {
        code = domCodeIndent(el.innerHTML);
      }
      html.value = code;
      html.onkeyup = html.onblur = () => {
        el.innerHTML = html.value.replace(/\s*\uFEFF\s*/g,'');
        el.dispatchEvent(new Event('input',{bubbles:true,cancelable:true}));
      }
      document.body.append(wrapper);

      function hide(e) {
        if (e.key==='Escape' || e.target !== html) {
          wrapper.remove();
          document.removeEventListener('keydown',hide);
          document.removeEventListener('mousedown',hide);
          el.focus();
        }
      };
      setTimeout(()=>{
        document.addEventListener('keydown',hide);
        document.addEventListener('mousedown',hide);
      },3);
    },
    shortcut:'h'
  });
  el.classList.add('expert');
}
/* insert table */
Rte.ui.setItem('Table', {
  click() {
    const table = c1.dom.el('<table><tr><td>&nbsp;<td>&nbsp;<tr><td>&nbsp;<td>&nbsp;</table>');
    const r = getSelection().getRangeAt(0);
    r.deleteContents();
    r.insertNode(table);
    getSelection().collapse(find(table, 'td'),0);
  },
  enable(){
    return !BLOCKLESS_ELEMENTS[Rte.active.tagName];
  }
});
/* delete Element */
Rte.ui.setItem('Del',{
  click() { unwrap(Rte.element); },
  el: c1.dom.el('<a style="color:red">Delete element</a>')
});
/* Target */
Rte.ui.setItem('LinkTarget', {
  enable:'a, a > *',
  check(el) {
    el = el.closest('a');
    const target = el.getAttribute('target');
    return target && target !== '_self';
  },
  click(){
    const el = Rte.element.closest('a');
    const active = this.el.classList.contains('active');
    el.setAttribute('target', active?'_self':'_blank');
    Rte.trigger('input');
    Rte.active.focus();
    Rte.trigger('elementchange');
  },
  el: c1.dom.el('<div class="-item -button">Link in neuem Fenster</div>')
});
/* Titletag *
{
  let el = c1.dom.el('<table style="clear:both"><tr><td style="width:5.25rem">Titel<td><input>');
  let inp = find(el, 'input');
  inp.addEventListener('keyup', function() {
    Rte.element.setAttribute('title',inp.value);
    !inp.value && Rte.element.removeAttribute('title');
    Rte.trigger('input');
  });
  Rte.ui.setItem('AttributeTitle',{
    check(el) {
      inp.value = el?.getAttribute('title') ?? '';
    },
    el: el
  });
}
/* Image Attributes */ {
  const inp = c1.dom.el(
    '<table>'+
      '<tr><td style="width:5.25rem">Width:<td><input class=-x>'+
      '<tr><td>Height:<td><input class=-y>'+
      '<tr><td title="Alternativer Text">Alt-Text:<td><input class=-alt>'+
    '</table>');
  inp.addEventListener('keyup',e=>{
    const img = Rte.element;
    img.style.width  = find(inp, '.-x').value+'px';
    img.style.height = find(inp, '.-y').value+'px';
    img.setAttribute('alt', find(inp, '.-alt').value);
    if (e.target.classList.contains('-x') || e.target.classList.contains('-y')) {
      Rte.element.dispatchEvent(new Event('qgResize',{bubbles:true}));
    }
    Rte.active.dispatchEvent(new Event('input',{bubbles:true,cancelable:true})); // used!
    Rte.trigger('input'); // used?
  })
  Rte.ui.setItem('ImageDimension', {
    check(el) {
      find(inp, '.-x').value = el.offsetWidth;
      find(inp, '.-y').value = el.offsetHeight;
      find(inp, '.-alt').value = el.getAttribute('alt');
    },
    el:inp,
    enable:'img'
  });
}


const imgSizeCache = {};
function ImageRealSize(url, cb) {
  if (!imgSizeCache[url]) {
    const nImg = new Image();
    nImg.src = url;
    nImg.onload = () => {
      cb.apply(null, imgSizeCache[url] = [nImg.width, nImg.height]);
    };
  } else {
    cb.apply(null,imgSizeCache[url]);
  }
}


/* original image */
Rte.ui.setItem('ImgOriginal', {
  enable: 'img',
  click() {
    const img = Rte.element;
    const url = img.getAttribute('src').replace(/\/(w|h|zoom|vpos|hpos|dpr)-[^\/]+/g,'');
    ImageRealSize(url, (w,h) => {
      w /= 2; h /= 2; // the server is told via cookie to deliver double resolution
      make(w,h);
    });
    function make(w,h) {
      img.setAttribute('src',url);
      img.setAttribute('width',w);
      img.setAttribute('height',h);
      img.style.width = '';
      img.style.maxWidth = '100%';
      img.style.height = 'auto';
      Rte.element.dispatchEvent(new Event('qgResize',{bubbles:true})); // new
      Rte.trigger('input');
      Rte.trigger('elementchange');
    }
  },
  el: c1.dom.el('<span class="-item -button" title="Original size">Original image</span>')
});

/* table handles */
{
  let td, tr, table, index;
  const handles = new TableHandles();
  Rte.on('deactivate',() => handles.hide() );
  const positionize = () => {
    const e = Rte.element;
    if (!e) return;
    td = e.closest('td');
    if (Rte.active?.contains(td)) {
      tr = td.parentNode;
      table = tr.closest('table');
      index = td.cellIndex;
      handles.showTd(td);
    } else {
      handles.hide();
    }
  }
  Rte.on('elementchange activate', positionize);
  handles.root.addEventListener('click',e=>{
    if (e.target.classList.contains('-rowRemove')) tr.remove();
    if (e.target.classList.contains('-rowAdd')) {
      const tr2 = tr.cloneNode(true);
      tr.after(tr2)
    }
    if (e.target.classList.contains('-colRemove')) {
      const trs = findAll(table, '> * > tr');
      for (const tr of trs) tr.children[index].remove();
    }
    if (e.target.classList.contains('-colAdd')) {
      const trs = findAll(table, '> * > tr');
      for (const tr of trs) {
        const td = c1.dom.el('<td><br>'); // firefox needs <br> to be able to navigate to the cell
        tr.children[index].after(td);
      }
    }
    const hasTds = findAll(table, '> * > tr > *').length;
    !hasTds && table.remove();
    getSelection().modify('move', 'right', 'character'); // chrome bug
    getSelection().modify('move', 'left', 'character');
    Rte.checkSelection();
  });
}

Rte.ui.config = {
  rteDef:{
    main:['LinkInput','Bold','Insertunorderedlist','Link','Removeformat','Format','Style'],
    more:['Italic','Insertorderedlist','Strikethrough','Underline','Hr','Code','Table','Shy',/*'ShowInvisibleChars',*/'LinkTarget','ImgOriginal','ImgOriginalRetina',/*'AttributeTitle',*/'ImageDimension','Tree']
  },
  rteMin:{
    main:['Bold','Insertunorderedlist','Link','Style']
  },
};




{ // show shy, todo: deprecated? css hyphens and text-wrap:balance are widely supported
  Rte.ui.setItem('Shy',{
    click() {
      Rte.range.deleteContents();
      Rte.range.insertNode(document.createTextNode('\u00AD'));
      console.warn('needed? should this be deprecated?');
    },
    el: c1.dom.el('<div class="-item -button">Insert soft hyphen</div>')
  });
  document.head.append(
    c1.dom.el(
      '<style>'+
    '.qgRte-mark-char.-Shy::after  { content:"-"; display:inline-block; color:red; opacity:.3; } '+
    //'.qgRte-mark-char.-Nbsp::after { content:"•"; display:inline-block; color:red; opacity:.3; } '+
    '</style>')
  );

  const addMarks = () => {
    // remove
    const anchor = getSelection().anchorNode;
    if (!anchor) return;
    anchor.parentNode.querySelectorAll('.qgRte-mark-char').forEach(marker => !marker.firstChild && marker.remove());

    //matchText(Rte.active, new RegExp('\u00AD|\u00a0', 'g'), function(node, match, offset) {
    matchText(Rte.active, new RegExp('\u00AD', 'g'), (node, match) => {
      if (node.parentNode.classList.contains('qgRte-mark-char')) return false;
      const span = document.createElement('span');
      span.className = 'qgRte-mark-char';
      if (match === '\u00AD') span.className += ' -Shy';
      //if (match === '\u00a0') span.className += ' -Nbsp';
      span.textContent = match;
      return span;
    });
  };
  const removeMarks = () => {
    Rte.active.querySelectorAll('.qgRte-mark-char').forEach(el=>unwrap(el))
    Rte.active.normalize();
  }
  Rte.on('activate',addMarks);
  Rte.on('input',addMarks);
  Rte.on('deactivate',removeMarks);


  const matchText = (node, regex, callback, excludeElements) => {
    excludeElements ||= ['script', 'style', 'iframe', 'canvas'];
    let child = node.firstChild;
    while (child) {
      if (child.nodeType === 1) {
        if (excludeElements.includes(child.tagName.toLowerCase())) break;
        matchText(child, regex, callback, excludeElements);
      }
      if (child.nodeType === 3) {
        let bk = 0;
        child.data.replace(regex, function(str) {
          const args = [].slice.call(arguments);
          const tag = callback.apply(globalThis, [child].concat(args));
          if (!tag) return false;
          const offset = args[args.length - 2];
          const newTextNode = child.splitText(offset+bk);
          bk -= child.data.length + str.length;
          newTextNode.data = newTextNode.data.slice(str.length);
          child.parentNode.insertBefore(tag, newTextNode);
          child = newTextNode;
        });
        regex.lastIndex = 0;
      }
      child = child.nextSibling;
    }
    return node;
  };

}

/* *
{ // show line-breaks
  document.head.append(
    c1.dom.el(
    '<style>'+
    '.qgRte-mark-char.-Br::before { '+
    '  content:"↵";'+
    '  display:inline;'+
    '  display:contents;'+
    '  opacity:.3;'+
    '  margin-left:.2em; '+
    '  font-size:.82em; '+
    '  pointer-events:none; '+ // I don't think it'll do any good
    '}'+
    '</style>')
  );
  function addMarks(){
    if (!Rte.active) return;
    Rte.active.querySelectorAll('br').forEach(br=>{
      if (br.previousElementSibling?.classList?.contains('-Br')) return;
      const span = document.createElement('span');
      span.className = 'qgRte-mark-char -Br';
      br.before(span);
    });
  }
  Rte.on('activate',addMarks);
  Rte.on('input',addMarks);
}
/* */
