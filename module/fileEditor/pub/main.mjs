import { api } from '@qino/pub/qino.js';
const btn = document.getElementById('saveButton');
const editorEl = document.getElementById('editor');
const mime   = editorEl.getAttribute('mime');
const query  = new URLSearchParams(location.search);
const file   = query.get('file');
// the capability that opened this page also authorises the save
const exp    = query.get('exp') ?? undefined;
const sig    = query.get('sig') ?? undefined;
let cmLine = editorEl.getAttribute('line')-1;
const cmCol  = editorEl.getAttribute('col')-1;

function saveFile(content){
  btn.style.backgroundColor = '#fea';
  api.fileEditor.save.put({ file, content, exp, sig }).then(asw => {
    if (asw) {
      btn.style.backgroundColor = '';
      btn.style.display = 'none';
    }
  });
}

btn.addEventListener('click', () => saveFile(editor.getValue()));


function saveEvent(e){
  if (e.key === 's' && e.ctrlKey) {
    btn.dispatchEvent(new Event('click'));
    e.preventDefault();
  }
}
const editor = CodeMirror.fromTextArea(editorEl, {
  lineNumbers: true,
  theme:       'eclipse',
  mode:        {name:mime, globalVars:true},
  keyMap:      'sublime',
  extraKeys:   {"Ctrl-Space": "autocomplete"},
  lineWrapping:true,
  matchTags:   {bothTags: true},
  showTrailingSpace: true,
  indentWithTabs: true,
  smartIndent: true,
  indentUnit: 4,
  tabSize: 4,
  highlightSelectionMatches: {showToken: /\w/, annotateScrollbar: true},
});
editor.focus();
editor.getWrapperElement().ownerDocument.addEventListener('keydown', saveEvent, 0);

editor.on('change', ()=>{
  btn.style.display = 'block';
  btn.style.backgroundColor = '#faa';
});

if (cmLine !== '' && cmLine !== -1) {
  cmLine = parseInt(cmLine);
  setTimeout(()=>{
    editor.setCursor(cmLine, cmCol);
    editor.addLineClass(cmLine, null, 'markLine');
    const line = document.querySelector('.CodeMirror-lines .markLine');
    line?.scrollIntoView({ behavior: 'auto', block:'center'});
  }, 200);
}
