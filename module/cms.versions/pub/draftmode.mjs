import { apt, ctx } from '../../core/pub/js/qino.js';

const sysURL = ctx.sysURL;
const nodeId = globalThis.qino?.cms?.nodeId;
function panelRoot() {
  return document.querySelector('qino-cms')?.shadowRoot || document;
}
function panelEl(selector) {
  return panelRoot().querySelector(selector);
}
cms.contextMenueContent.addItem('Publish', {
  icon: sysURL+'cms.versions/pub/check.png',
  selector: '[qcms-id]',
  onshow(e) {
    this.activePid = cms.contPos.active.pid;
    this.disabled = !e.currentTarget.hasAttribute('qcms-edit');
  },
  onclick() {
    publish(this.activePid);
  }
});
function publish(pid, subPages){
  if (!confirm('Really overwrite the current live version?')) return;
  apt['cms.versions']['publish-node'].post({ pid: Number(pid), options: {toSpace:0, subPages} }).then(() => {
    location.href = location.href.replace(/#.*$/,'');
  });
}
// frontend integration
const css =
'#qgCmsFrontend1 [itemid=publish].-HasChanges > .-title, #panel [itemid=publish].-HasChanges > .-title { '+
'  background:var(--cms-access-2); '+
'} '+
'#qgCmsFrontend1 [itemid=publish].-HasChanges > .-title::before, #panel [itemid=publish].-HasChanges > .-title::before { '+
'  border-right-color:var(--cms-access-2); '+
'} '+
'#qgCmsFrontend1 [itemid=publish].-HasChanges .qgCms_vers_page_changed, #panel [itemid=publish].-HasChanges .qgCms_vers_page_changed { '+
'  display:block; '+
'} '+
'';
const el = c1.dom.fragment('<div class=-item itemid=publish>'+
  '<div class=-content>'+
    '<div class=-standalone>'+
      '<div class=-h1>Draft</div>'+
      '<div>Overwrite your draft with the current live version</div>'+
      '<div style="text-align:right">'+
        '<button class=-versionUnPublish style="width:12.5rem">Reset draft</button><br><br>'+
        '<label>including subpages <input class=-subPages type=checkbox style="vertical-align:text-bottom"></label><br>'+
      '</div>'+
      '<br><br><br>'+
      '<div class=-h1>Compare</div>'+
      '<div>Compare the differences between draft and live version</div>'+
      '<div style="text-align:right">'+
        '<button style="width:12.5rem" class=-versionCompare>Compare</button>'+
      '</div>'+
      '<br><br><br>'+
      '<div class=-h1>Publish</div>'+
      '<div>Make your draft public!</div>'+
      '<div class=qgCms_vers_page_changed hidden style="color:var(--cms-access-2);">You have unpublished changes!</div>'+
      '<br>'+
      '<div style="text-align:right">'+
        '<button class=-versionPublish style="width:12.5rem">Publish</button><br><br>'+
        '<label>including subpages <input class=-subPages type=checkbox style="vertical-align:text-bottom"></label><br>'+
      '</div>'+
    '</div>'+
  '</div>'+
  '<div class=-title style="xposition:relative">'+
    '<div class=-text>Draft</div>'+
  '</div>'+
  '<style>'+css+'</style>'+
  '</div>').firstChild;
panelEl('#qgCmsFrontend1 > .-sidebar > [itemid="more"], #panel > .-sidebar > [itemid="more"]')?.append(el);

el.querySelector('.-versionCompare').addEventListener('click', async ()=>{
  const { comparer } = await import('./comparer.mjs');
  comparer.compare(nodeId,{
    toSpace:0,
    accept(){ publish(nodeId); },
    acceptText:'Publish'
  });
});
el.querySelector('.-versionPublish').addEventListener('click',function(){
  const subPages = this.parentNode.querySelector('.-subPages').checked;
  publish(nodeId, subPages);
});
el.querySelector('.-versionUnPublish').addEventListener('click',function(){
  const subPages = this.parentNode.querySelector('.-subPages').checked;
  if (!confirm("Warning!\nReally overwrite the draft?")) return;
  apt['cms.versions']['publish-node'].post({ pid: nodeId, options: {toSpace:1, fromSpace:0, subPages} }).then(()=>{
    location.href = location.href.replace(/#.*$/,'');
  });
});

// // change "changed-status"
// Ask.on('complete', function(res) {
//   if (!res || !res.cms_vers_changed) return;
//   for (var pid in res.cms_vers_changed) {
//     pid == nodeId && el.classList.add('-HasChanges');
//   }
// });
