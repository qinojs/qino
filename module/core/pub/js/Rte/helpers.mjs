import {HTMLParser} from './htmlparser.mjs';

globalThis.domCodeIndent = function(str) {
  let res = '';
  let ind = '';
  let pre = false;
  str = str.replace(/\n|\t/g, ' ').replace(/<([\/a-zA-Z0-9]+)/g, a => a.toLowerCase());
  const makeStartTag = (tag, attrs, unary) => {
    let str = '<' + tag;
    for (let i = 0, att; (att = attrs[i++]);) {
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
      if (!/^\s/.test(text)) text = '\uFEFF'+text; // mark if no whitespace
      if (!/\s$/.test(text)) text += '\uFEFF';
      res += text;
      !pre && (res+='\n');
    },
    comment(text) {
      res += "<!--" + text + "-->";
    }
  });
  return res;
};

globalThis.getPossibleClasses = function (el) { /* eventuell better performance? */
  const ret = {};
  function test(sel) {
    sel = sel.trim();
    if (!sel.includes('.')) return;
    if (!/\.[A-Z]/.test(sel)) return;
    const reg = el ? new RegExp('(^'+el.tagName+'|^)\\.[^ ]+$', 'i') : new RegExp('^\\.[^ ]+$');
    if (reg.test(sel)) {
      const x = sel.replace(/^(.*\.)([^: ]*)(.*)$/, (_m, _a1, a2) => a2);
      ret[x] = sel;
    }
  }
  for (const sheet of document.styleSheets) {
    if (sheet.href && !sheet.href.includes(location.host)) continue; // only inline and same domain
    if (sheet.href === null) {
      try {
        if (sheet.ownerNode.innerHTML === '') continue; // adblock chrome
      } catch { /* ignore */ }
    }
    try { // (not same domain) security error in ff
      if (sheet.cssRules)
        for (const rule of sheet.cssRules) {
          if (!rule.selectorText) continue;
          rule.selectorText.split(',').forEach(test);
        }
    } catch(e) { console.log(e); }
  }
  return ret;
};
