import { apt } from '../../core/pub/js/apt.js';
const btn = document.getElementById('saveButton');
const editorEl = document.getElementById('editor');
const mime   = editorEl.getAttribute('mime');
const file   = new URLSearchParams(location.search).get('file');
let cmLine = editorEl.getAttribute('line')-1;
const cmCol  = editorEl.getAttribute('col')-1;

function saveFile(content){
	btn.style.backgroundColor = '#fea';
	apt.fileEditor.save.put({ file, content }).then(function(asw){
		if (asw) {
			btn.style.backgroundColor = '';
			btn.style.display = 'none';
		}
	});
};

btn.addEventListener('click',()=>{
	saveFile(editor.getValue());
});


function saveEvent(e){
	if (e.key === 's' && e.ctrlKey) {
		btn.dispatchEvent(new Event('click'));
		e.preventDefault();
	}
}
var editor = CodeMirror.fromTextArea(editorEl, {
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

editor.on('change', e=>{
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
