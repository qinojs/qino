let cnt = 0;
c1.contextMenu = function(root){
    const id = 'qgContextMenu_'+(cnt++);
    const menu = document.createElement('menu');
    menu.setAttribute('type','context');
    menu.setAttribute('id',id);
    root.append(menu);
    root.setAttribute('contextmenu',id);
    return new MenuItem(menu);
};
class MenuItem {
    constructor(menu){ this.menu = menu; }
    addItem(label, opt={}) { return this._add('menuitem', label, opt); }
    addMenu(label, opt={}) { return this._add('menu', label, opt); }
    _add(what, label, opt={}) {
        const root = document.documentElement;
        const menu = this.menu;
        const item = document.createElement(what);
        item.setAttribute('label',label);
        item.setAttribute('icon',opt.icon);
        opt.onclick && item.addEventListener('click', opt.onclick);
        root.addEventListener('contextmenu', e=>{
            const target = opt.selector ? e.target.closest(opt.selector) : root;
            if (!target) return;
            opt.onshow && opt.onshow.bind(item)({currentTarget:target});
            menu.append(item);
            setTimeout(()=>item.remove(),10);
        },true);
        return new MenuItem(item);
    }
}
Object.defineProperty(c1,'globalContextMenu',{
    get(){
        delete this.globalContextMenu;
        return this.globalContextMenu = new c1.contextMenu(document.documentElement);
    },
    configurable: true
});
