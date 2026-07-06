c1.form = {
  serializeObject: function(element) {
    let els;
    if (element instanceof Element) {
      els = [...(element.elements || element.querySelectorAll('input, select, textarea')), element];
    } else {
      els = Array.from(element);
    }
    const object = Object.create(null);
    els.forEach(el => {
      const value = c1.form.elementValue(el);
      if (value === undefined) return;
      const name = el.name;
      if (!name) return;
      const matches = name.match(/(^[^\[]+|\[[^\]]*\])/g);
      let active = object;
      for (let i=0, match; (match=matches[i++]);) {
        if (i>1) match = match.replace(/(^\[|\]$)/g,'');
        if (matches.length === i) {
          if (Array.isArray(active)) active.push(value);
          else active[match] = value;
        } else active[match] ||= matches[i] === '[]' ? [] : Object.create(null);
        active = active[match];
      }
    });
    return object;
  },
  elementValue: function(el){
    if (el.type === 'checkbox') return el.checked ? el.value : false;
    if (el.type === 'radio') {
      const form = el.form;
      const radios = document.getElementsByName(el.name);
      for (let i = 0, radio; (radio = radios[i++]);) {
        if (form !== radio.form) continue;
        if (!radio.checked) continue;
        return radio.value;
      }
      return;
    }
    return el.value;
  },
  fileDialog: function(options){
    options = Object.assign({
      multiple: true,
      accept: '',
    }, options);
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.multiple = options.multiple;
    inp.accept   = options.accept;
    inp.style.cssText = 'position:absolute; left:-999px; opacity:0.01';
    document.body.append(inp);
    inp.click();
    return new Promise(resolve => {
      setTimeout(() => {
        inp.addEventListener('change', () => {
          resolve(inp.files);
          inp.remove();
        }, {once: true});
      }, 99);
    });
  }
};

document.addEventListener('focusin', e => {
  e.target.c1OnFocusValue = e.target.value;
  e.target.c1OnFocusChecked = e.target.checked;
}, true);
document.addEventListener('focusout', e => {
  if (e.target.c1OnFocusValue === e.target.value && e.target.c1OnFocusChecked === e.target.checked) return;
  e.target.dispatchEvent(new CustomEvent('c1-changed', {bubbles: true}));
}, true);

export default c1.form;
