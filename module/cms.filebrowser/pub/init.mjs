import { apt } from '../../core/pub/js/apt.js';
'use strict';
c1.onElement('.qgCmsFileManager .-addExistingFile', el=>{
    let newButton = c1.dom.fragment('<button>select').firstChild;
    el.after(newButton);
    newButton.addEventListener('click', async e => {
        const fB = new cms.fileBrowser({multiple:true});
        fB.show();
        fB.on('select', async e=>{
            const pid = cms.cont.active || Page;
            for (const id of e.dbFiles) await apt.cms.node(pid).files.post({ file: String(id) });
            for (const url of e.urls) await apt.cms.node(pid).files.post({ file: url });
            //apt.cms.node(pid).html.get().then(html => { document.querySelector('.-pid'+pid).outerHTML = html; });
        });
    });
    el.style.display = 'none';
});

// replace file placeholders
c1.onElement('.qgCmsFileManager .-preview', el=>{
    el.addEventListener('click', async e => {
        e.stopImmediatePropagation();
        const replace = e.target.closest('tr').getAttribute('itemid');
        const fB = new cms.fileBrowser({multiple:false,local:1});
        fB.show();
        fB.on('select', async e=>{
            const pid = cms.cont.active || Page;
            const item = e.dbFiles[0] || e.urls[0];
            if (item) {
                await apt.cms.node(pid).files.post({ file: String(item), replace });
                cms.reloadNode(pid);
            }
            if (e.files) {
                cms.cont(pid).upload(e.files[0], function(){
                    cms.reloadNode(pid);
                }, replace);
            }
        });
    });
});


cms.fileBrowser = class {
    constructor(options={multiple:true}){
        this.options = options;
    }
    async show(){
        await c1.c1Use(['dialog','loading','form']);
        var body =
        '<div>'+
            '<input type=search placeholder="suchen..."> '+
            '<button class=-browse '+(this.options.local?'':'hidden')+'>Lokale Dateien</button>'+
            '<div class="-list -main"></div>'+
            '<style>'+
            '.cmsFileBrowser {'+
                'width:900px; left:50%; transform:translateX(-50%); top:20px; max-height:calc(100vh - 40px);'+
            '} '+
            '.cmsFileBrowser .-list {'+
                'min-height:40px; margin-top:1em; display: grid; grid-gap: 3px; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr) ); '+
            '} '+
            '.cmsFileBrowser .-list label {'+
                'position:relative; height:120px; border:1px solid #ddd; background:var(--cms-light) 50%/contain no-repeat; cursor:pointer; '+
                'transition:transform .15s linear; '+
            '} '+
            '.cmsFileBrowser .-list label:hover {'+
                'transform:scale(1.2);'+
                'z-index:1;'+
            '} '+
            '.cmsFileBrowser .-list label > .-title {'+
                'position:absolute;'+
				'bottom:0;'+
				'right:0;'+
				'left:0;'+
				'background:rgba(0,0,0,.8);'+
				'color:#fff;'+
				'padding:10px;'+
				'word-break:break-all;'+
				'opacity:1;'+
                'transition:opacity .6s;'+
            '} '+
            '.cmsFileBrowser .-list label:hover > .-title {'+
                'opacity:0;'+
            '} '+
            '</style>'+
        '</div>';
        const buttons = [
            // {title:'vom Computer', async then(){
            //     var files = await c1.form.fileDialog(); // must be in click event loop
            // }},
            {title:'Abbrechen'},
        ]
        if (this.options.multiple) {
            buttons.push({
                title:'Ok',
                then: async ()=>{
                    let elements = Array.from(dialog.element.c1FindAll('label[itemid]')).filter(item=>item.c1Find('[type=checkbox]').checked);
                    let items = elementsToItems(elements);
                    this.trigger('select', items);
                    dialog.hide();
                    dialog.element.remove();
                }
            })
        }
        var dialog = new c1.dialog({
            title:'Filebrowser',
            body,
            class:'qgCMS cmsFileBrowser',
            buttons
        });

        dialog.show();
        var list = dialog.element.c1Find('.-list.-main');

        if (!this.options.multiple) {

            list.after(c1.dom.fragment('<style>.cmsFileBrowser .-list label > [type=checkbox] { display:none; }</style>'));

            dialog.element.addEventListener('click',e=>{
                let target = e.target.closest('label[itemid]')
                if (!target) return;
                let items = elementsToItems([target]);
                this.trigger('select',items);
                dialog.hide();
                dialog.element.remove();
                //},{once:true}) // otherwise its triggered twice!!!! why!?
            });
        }

        function elementsToItems(elements){
            let items = {dbFiles:[], urls:[]};
            Array.from(elements).forEach(item=>{
                let type = item.getAttribute('data-type')+'s';
                items[type] ||= [];
                items[type].push(item.getAttribute('itemid'));
            });
            return items;
        }

        dialog.element.c1Find('[type=search]').addEventListener('input',function(e){
            search(e.target.value);
        }.c1Debounce(600));

        dialog.element.c1Find('.-browse').addEventListener('click', async e=>{
            var files = await c1.form.fileDialog({accept:this.options.accept, multiple:this.options.multiple});
            this.trigger('select', { files, dbFiles:[], urls:[] });
            dialog.hide();
            dialog.element.remove();
        });


        var search = needle=>{
            c1.loading.mark(list);
            apt['cms.filebrowser'].search.get({ s: needle ?? '' }).then(result=>{
                c1.loading.done(list);

                let has = {};
                Array.from(list.children).forEach(label=>{
                    const checkbox = label.c1Find('[type=checkbox]');
                    if (checkbox?.checked) {
                        has[label.getAttribute('itemid')] = 1;
                    } else {
                        label.remove();
                    }
                })

                for (let item of result) {
                    if (has[item.id]) continue;
                    let el = c1.dom.fragment(
                        '<label data-type=dbFile itemid="'+item.id+'">'+
                            '<input type="checkbox" style="position:absolute; top:8px; left:8px">'+
                            '<div class=-title>'+
                                item.name+
                            '</div>'+
                        '</label>'
                    ).firstChild;
                    if (item.mime.includes('image/')) {
                        el.style.backgroundImage = 'url("'+item.url+'/w-180/h-130/max/image")';
                    } else {
                        el.prepend(
                            c1.dom.fragment(
                                '<div style="position:absolute; inset:0; display:flex; justify-content: center; align-items: center; font-size:3.6em; color:#fff">'+
                                    item.name.replace(/.*\.([^.]+)$/,'$1').slice(-4).toUpperCase()+
                                '</div>'
                            )
                        )
                    }
                    list.append(el);
                }
            });
        }
		search();
    }
}
Object.assign(cms.fileBrowser.prototype, c1.Eventer);
