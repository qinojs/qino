/* Copyright (c) 2016 Tobias Buschor https://goo.gl/gl0mbf | MIT License https://goo.gl/HgajeK */
import {HTMLParser} from './htmlparser.mjs';

window.domCodeIndent = function(str) {
	let res = '';
	let ind = '';
	let pre = false;
	str = str.replace(/\n|\t/g, ' ').replace(/<([\/a-zA-Z0-9]+)/g, function(a) { return a.toLowerCase(); });
	var makeStartTag = function(tag, attrs, unary) {
		let str = '<' + tag;
		for (var i = 0, att; att = attrs[i++];) {
			str += ' ' + att.name + '="' + att.escaped + '"';
		}
		str += (unary?'/':'')+'>';
		return str;
	};
	HTMLParser(str,{
		start(tag, attrs, unary) {
			pre = tag==='pre' ? true : pre;
			!pre && (res += ind);
			res += makeStartTag(tag,attrs,unary);
			!pre && (res+='\n');
			!unary && (ind += '\t');
		},
		end(tag) {
			pre = tag==='pre' ? false : pre;
			!pre && (ind=ind.slice(1));
			res += ind+'</' + tag.toLowerCase() + '>';
			!pre && (res+='\n');
		},
		chars(text) {
			!pre && (res += ind);
			if (!text.match(/^\s/)) text = '\uFEFF'+text; // mark if no whitespace
			if (!text.match(/\s$/)) text += '\uFEFF';
			res += text;
			!pre && (res+='\n');
		},
		comment(text) {
			res += "<!--" + text + "-->";
		}
	});
	return res;
};

window.getPossibleClasses = function (el) { /* eventuell better performance? */
	var ret = {};
	function test(sel) {
		sel = sel.trim();
		if (!~sel.indexOf('.')) return;
		if (!sel.match(/\.[A-Z]/)) return;
		var reg = el ? new RegExp('(^'+el.tagName+'|^)\\.[^ ]+$', 'i') : new RegExp('^\\.[^ ]+$');
		if (sel.match(reg)) {
			var x = sel.replace(/^(.*\.)([^: ]*)(.*)$/, function(m, a1, a2) { return a2; });
			ret[x] = sel;
		}
	}
	for (let sheet of document.styleSheets) {
		if (sheet.href && !sheet.href.includes(location.host)) continue; // only inline and same domain
		if (sheet.href === null) {
			try {
				if (sheet.ownerNode.innerHTML === '') continue; // adblock chrome
			} catch(e) { }
		}
        try { // (not same domain) security error in ff
			if (sheet.cssRules)
				for (let rule of sheet.cssRules) {
					if (!rule.selectorText) continue;
	    			rule.selectorText.split(',').forEach(test);
				}
        } catch(e) { console.log(e); }
	}
	return ret;
};
