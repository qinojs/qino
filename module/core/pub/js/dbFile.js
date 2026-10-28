import { ctx } from './qino.js';

/** A dbFile url split into id, parts (w, h, …) and name; from an element's src (written back) or a url. */
export class DbFile {
  constructor(src) {
    if (typeof src !== 'string') { this.el = src; src = src.getAttribute('src'); }
    const parts = src.replace(/.*dbFile\//, '').split('/');
    this.name = parts.pop();
    this.id   = parts.shift();
    this.parts = {};
    for (const s of parts) { if (s) { const [k, v] = s.split('-'); this.parts[k] = v; } }
  }
  get(part)        { return this.parts[part]; }
  set(part, value) { this.parts[part] = value; this.write(); return this; }
  write()          { this.el?.setAttribute('src', this.toString()); }
  toString() {
    let src = '';
    for (const part in this.parts) {
      src += '/' + part;
      if (this.parts[part] !== undefined) src += '-' + this.parts[part];
    }
    return ctx.appUrl + 'dbFile/' + this.id + src + '/' + this.name;
  }
}
