class Masker {
    constructor(){
        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.classList.add('c1IntroSvg');
        const id = Math.random();
        svg.innerHTML =
        '<defs>'+
            '<mask id="mask'+id+'">'+
                '<rect fill="#fff" x="0" y="0" width="9100" height="9100"></rect>'+
                '<g class="-container">'+
                    //'<rect x="0" y="0" width="130" height="170" rx="20" ry="20" ></rect>'+
                '</g>'+
            '</mask>'+
        '</defs>'+
        '<rect mask="url(#mask'+id+')" fill="#222" x="0" y="0" width="9100" height="9100"></rect>';
        svg.addEventListener('mousedown',e=>{
            e.stopPropagation();
            e.preventDefault();
        });
        this.svg = svg;
        this.$svg = $(this.svg);
        this.$container = this.$svg.find('.-container');
        //let self = this;
        document.body.append(this.svg);
    }
    show(){
        this.svg.removeAttribute('hidden');
        this.svg.c1ZTop();
        this.svg.style.height = document.innerHeight+'px';
        this.svg.style.width  = document.innerWidth+'px';
    }
    hide(){
        this.svg.hidden = true;
    }
}

document.head.append(c1.dom.fragment(
    '<style>'+
        '.c1IntroSvg {'+
          'position:absolute;'+
          'top:0; '+
          'left:0; '+
          'right:0; '+
          'bottom:0; '+
          //'pointer-events:none;'+
          'height:100%;'+
          'width:100%;'+
          'opacity:0;'+
          'visibility:hidden;'+
          'display:block;'+
          'overflow:hidden;'+
          'transition:opacity .2s; '+
        '}'+
        '.c1IntroSvg:not([hidden]) {'+
          'opacity:.7;'+
          'visibility:visible;'+
        '}'+
     '</script>'
));

/* intro */
const intro = {};
intro.masker = new Masker();
const tmp = document.createElementNS("http://www.w3.org/2000/svg", "rect");
intro.$rect = $(tmp).attr({rx:10,ry:10});
intro.$rect[0].style.transition = 'all .3s';
intro.masker.$container.append(intro.$rect);
intro.$info = $('<div class=c1IntroInfo>');
$(()=>{
    intro.$info.appendTo(document.body);
});
intro.show = function(selector, description){
    const element = document.querySelector(selector);
    const coords = element.getBoundingClientRect();
    intro.$rect.css({
        x:      coords.left   - 5,
        y:      coords.top    - 5,
        width:  coords.width  + 10,
        height: coords.height + 10
    });
    intro.masker.show();
    intro.$info.fadeOut(100);
    intro.$info.css({
        background:'#fff',
        padding: 20,
        position:'absolute',
        left: coords.left - 410,
        top:  coords.top + 130
    });
    intro.$info[0].c1ZTop();
    intro.$info.html(description).fadeIn();
};
intro.hide = function(){
    intro.masker.hide();
    intro.$info.fadeOut();
};

function wait(seconds){
    return new Promise(ok=>setTimeout(ok,seconds*1000));
}
/* test */
document.addEventListener('DOMContentLoaded', async function(){
    await wait(1);
    cms.panel.sidebar.set('settings');
    await wait(1);
    intro.show('#panel [itemid="settings"]', 'Here you can change settings');
    await wait(1);
    cms.panel.sidebar.set('add');
    intro.show('#panel [itemid="add"]', 'Drag new content onto your page');
    await wait(1);
    cms.panel.sidebar.set('');
    const el = document.querySelector('[qcms-mod="cont.text"]');
    cms.contPos(el).mark()
    intro.show('[qcms-mod="cont.text"]', 'This content is a text module');
    await wait(1);
    intro.show('#qgCmsContPosMenu > .-opts', 'Click here to access the settings');
    await wait(1);
    cms.panel.sidebar.set('settings');
    await wait(1);
    intro.show('#panel [itemid="settings"] > [widget]', 'Here you can change settings');
});
