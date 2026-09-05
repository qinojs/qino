import '../c1.js';
// scoped query helper
const find = (el, sel) => el.querySelector(':scope '+sel);

export class TableHandles {
  constructor() {
    const remImgData = '\'data:image/svg+xml;utf8,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" stroke="#ee3c3c" stroke-width="14"><line x1="4" y1="4" x2="60" y2="60"/><line x1="4" y1="60" x2="60" y2="4"/></svg>')+'\'';
    const addImgData = '\'data:image/svg+xml;utf8,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" stroke="#444" stroke-width="14"><line x1="0" y1="32" x2="64" y2="32"/><line x1="32" y1="0" x2="32" y2="64"/></svg>')+'\'';
    this.root = c1.dom.el(
      `<div class=c1TableHandles>
      <a class=-rowRemove></a>
      <a class=-rowAdd></a>
      <a class=-colAdd></a>
      <a class=-colRemove></a>
      <style>
      .c1TableHandles > a {
        position: absolute;
        z-index:1998; /* content chrome, just below #qgRteToolbar */
        border:1px solid #555;
        border-radius: 50%;
        width: 22px;
        height: 22px;
        cursor:pointer;
        background: #fff url(${remImgData}) 50% / 50% no-repeat;
      }
      .c1TableHandles > a.-rowAdd, .c1TableHandles > a.-colAdd {
        background-image: url(${addImgData});
      }
      </style>
    </div>`);

    this.rowRemove = find(this.root, '.-rowRemove');
    this.rowAdd    = find(this.root, '.-rowAdd');
    this.colAdd    = find(this.root, '.-colAdd');
    this.colRemove = find(this.root, '.-colRemove');
    this.root.addEventListener('mousedown',e=>e.preventDefault());
  }
  showTd(td) {
    this.active = td;
    document.body.append(this.root);
    this.positionize(td);
    clearInterval(this.checkIntr);
    this.checkIntr = setInterval(this.handleEvent.bind(this), 100);
    document.addEventListener('keydown', this);
  }
  hide() {
    this.root.remove();
  }
  positionize(td) {
    const tr = td.parentNode;
    if (!tr) return;
    let cpos = td.getBoundingClientRect();
    cpos = {
      top:  cpos.top + scrollY,
      left: cpos.left + scrollX,
    }
    const table = tr.closest('table');
    if (!table) return;
    let tpos = table.getBoundingClientRect();
    tpos = {
      top:  tpos.top + scrollY,
      left: tpos.left + scrollX,
    }
    this.rowRemove.style.cssText = 'top:'+(cpos.top + (tr.offsetHeight / 2) - 11)+'px; left:'+(tpos.left - 25)+'px;';
    this.rowAdd.style.cssText    = 'top:'+(cpos.top + tr.offsetHeight - 4)+'px;        left:'+(tpos.left - 25)+'px;';
    this.colRemove.style.cssText = 'top:'+(tpos.top - 25)+'px;                         left:'+(cpos.left + (td.offsetWidth / 2) - 8)+'px;';
    this.colAdd.style.cssText    = 'top:'+(tpos.top - 25)+'px;                         left:'+(cpos.left + td.offsetWidth - 2)+'px;';
  }
  handleEvent() {
    setTimeout(()=>{
      if (this.root.parentNode) {
        this.positionize(this.active);
      } else {
        clearInterval(this.checkIntr);
        document.removeEventListener('keydown', this);
      }
    });
  }
};
