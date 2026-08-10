/**
 * Simulates how mail clients render HTML: drops what a client ignores, renders VML,
 * and reports every change. Browser only, it needs DOMParser and CSSOM.
 *
 *   const sim = new EmailClientSimulator(source);
 *   const { html, report } = sim.render('outlookWord');
 *   const advice = sim.check('outlookWord');
 *
 * Profiles are plain objects, so a variant is just a spread: {...clients.outlookWord, mso: 12}.
 */

const groups = {
  fx: ['border-radius', 'box-shadow', 'text-shadow', 'opacity', 'transform', 'transition', 'animation', 'filter', 'backdrop-filter', 'clip-path', 'mix-blend-mode', 'mask'],
  layout: ['float', 'position', 'top', 'right', 'bottom', 'left', 'z-index', 'overflow', 'flex', 'grid', 'gap', 'row-gap', 'column-gap', 'align-items', 'align-content', 'align-self', 'justify-items', 'justify-content', 'justify-self', 'order', 'aspect-ratio', 'inset', 'object-fit', 'columns', 'column-count', 'column-width'],
  sizing: ['max-width', 'min-width', 'max-height', 'min-height'],
  bgImage: ['background-image', 'background-size', 'background-position', 'background-repeat', 'background-attachment', 'background-origin', 'background-clip', 'background-blend-mode'],
  fixed: ['position', 'top', 'right', 'bottom', 'left', 'z-index'],
};
const g = (...names) => names.flatMap(n => groups[n]);

const dropMedia = /^(svg|canvas|video|audio)$/;
const unwrapBox = /^(form|picture)$/;

/**
 * Client profiles. Keys: mso (Word engine version, 0 = none), width (viewport px),
 * drop (property prefixes), dropIf ([propRegex, valueRegex]), dropAt (at-rule names),
 * dropSelector, dropEl (removed), unwrapEl (replaced by its content), noVars,
 * noStyleTags, linkedCss, maxBytes, defaults, quirks.
 */
export const clients = {
  browser: {
    label: 'Browser (reference)',
    notes: 'No filtering, everything renders. Conditional mso blocks stay hidden, as in any browser.',
    width: 800,
    linkedCss: true,
  },
  outlookWord: {
    label: 'Outlook 2007-2021 (Windows, Word engine)',
    notes: 'No border-radius, gradients, background images, float, position, max-width or media queries, no padding on a, p and li. Conditional mso comments apply, VML renders.',
    width: 600,
    mso: 16,
    drop: [...g('fx', 'layout', 'sizing', 'bgImage'), 'letter-spacing', 'text-overflow', 'word-break', 'white-space'],
    dropIf: [[/^display$/, /flex|grid|inline-block|table-cell/]],
    dropAt: /media|supports|font-face|keyframes|import|container|layer/,
    dropSelector: /[:[>~+]/,
    dropEl: /^(svg|canvas)$/,
    unwrapEl: /^(form|picture|video|audio)$/,
    noVars: true,
    defaults: 'body{font-family:"Times New Roman",serif;font-size:12pt}',
    quirks: 'a,p,li{padding:0!important}img{max-width:none!important}',
  },
  outlookNew: {
    label: 'New Outlook / Outlook.com',
    notes: 'Modern webview, but without CSS variables, position:fixed and webfonts. Conditional comments and VML are ignored.',
    width: 600,
    dropIf: [[/^position$/, /fixed/]],
    dropAt: /font-face|import/,
    dropEl: dropMedia,
    unwrapEl: unwrapBox,
    noVars: true,
    defaults: 'body{font-family:"Segoe UI",Arial,sans-serif;font-size:14px}',
  },
  gmailWeb: {
    label: 'Gmail Web',
    notes: 'style in the head works, but no CSS variables, no position, no external stylesheets. Above 102 KB the mail is clipped.',
    width: 600,
    drop: g('fixed'),
    dropAt: /import/,
    dropEl: /^(svg|canvas|video|audio|input|select|textarea|button)$/,
    unwrapEl: unwrapBox,
    noVars: true,
    maxBytes: 102400,
    defaults: 'body{font-family:Arial,sans-serif;font-size:14px}',
  },
  gmailApp: {
    label: 'Gmail app with a third-party account (POP/IMAP)',
    notes: 'Drops embedded stylesheets completely, only what sits inline on the element survives.',
    width: 400,
    drop: g('fixed'),
    dropEl: /^(svg|canvas|video|audio|input|select|textarea|button)$/,
    unwrapEl: unwrapBox,
    noStyleTags: true,
    noVars: true,
    maxBytes: 102400,
    defaults: 'body{font-family:Arial,sans-serif;font-size:14px}',
  },
  appleMail: {
    label: 'Apple Mail / iOS Mail',
    notes: 'WebKit with practically complete CSS support, including media queries and webfonts.',
    width: 720,
    unwrapEl: /^form$/,
    linkedCss: true,
    defaults: 'body{font-family:Helvetica,Arial,sans-serif;font-size:15px}',
  },
  yahoo: {
    label: 'Yahoo Mail',
    notes: 'Modern engine, but without position and without CSS variables.',
    width: 600,
    drop: g('fixed'),
    dropAt: /import/,
    dropEl: dropMedia,
    unwrapEl: unwrapBox,
    noVars: true,
    defaults: 'body{font-family:Arial,Helvetica,sans-serif;font-size:14px}',
  },
};

const profile = client => {
  const c = typeof client === 'string' ? clients[client] : client;
  if (!c) throw new RangeError(`unknown mail client: ${client}`);
  return c;
};

/** Evaluates a downlevel condition such as "gte mso 9" or "!mso" against the engine version. */
const msoMatch = (cond, mso) => {
  const c = cond.toLowerCase();
  if (!mso || !/\bmso\b/.test(c) || /!\s*mso/.test(c)) return false;
  const [, op, n] = c.match(/\b(lte|lt|gte|gt)?\s*mso\s*(\d+)/) ?? [];
  if (!n) return true;
  return { lte: mso <= +n, lt: mso < +n, gte: mso >= +n, gt: mso > +n }[op] ?? mso === +n;
};

/** Resolves downlevel-hidden and downlevel-revealed comments for the given mso version. */
const resolveConditionals = (html, mso) => html
  .replace(/<!--\[if !mso[^\]]*\]><!-->([\s\S]*?)<!--<!\[endif\]-->/gi, mso ? '' : '$1')
  .replace(/<!--\[if ([^\]]*)\]>([\s\S]*?)<!\[endif\]-->/gi, (_, cond, inner) => msoMatch(cond, mso) ? inner : '');

const scratch = new CSSStyleSheet();
/** Parses a declaration list without a DOM and returns the CSSStyleDeclaration. */
const parseDeclarations = css => {
  scratch.replaceSync(`x{${css}}`);
  return scratch.cssRules[0].style;
};

const dropMaps = new WeakMap();
/** Longhand -> dropped entry, because the CSSOM enumerates a shorthand as its longhands. */
const dropMap = c => {
  let map = dropMaps.get(c);
  if (!map) {
    map = new Map();
    for (const p of c.drop ?? []) {
      map.set(p, p);
      for (const longhand of parseDeclarations(`${p}: initial`)) map.set(longhand, p);
    }
    dropMaps.set(c, map);
  }
  return map;
};

const dropped = (prop, c) => dropMap(c).get(prop) ?? c.drop?.find(p => prop.startsWith(p + '-'));

const reason = (prop, value, c) =>
  c.noVars && (prop.startsWith('--') || value.includes('var(')) ? 'CSS variables are not supported' :
  dropped(prop, c) ? 'property is ignored' :
  c.dropIf?.some(([p, v]) => p.test(prop) && v.test(value)) ? 'value is not supported' : null;

const cleanStyle = (style, c, where, log) => {
  const seen = new Set();
  // read first: removing one longhand makes the CSSOM expand the rest of its shorthand
  for (const [prop, value] of [...style].map(p => [p, style.getPropertyValue(p)])) {
    if (value === 'initial') continue; // part of a shorthand the author never set
    const why = reason(prop, value, c);
    if (!why) continue;
    style.removeProperty(prop);
    const name = dropped(prop, c) ?? prop; // report the shorthand once, not every longhand
    if (seen.has(name)) continue;
    seen.add(name);
    log('warn', where, `${name}: ${value}`, why);
  }
  return style.cssText;
};

const atNames = {
  CSSMediaRule: 'media', CSSSupportsRule: 'supports', CSSFontFaceRule: 'font-face',
  CSSKeyframesRule: 'keyframes', CSSImportRule: 'import', CSSContainerRule: 'container', CSSLayerBlockRule: 'layer',
};

const cleanRules = (rules, parent, c, log) => {
  for (let i = rules.length - 1; i >= 0; i--) {
    const rule = rules[i], at = atNames[rule.constructor.name];
    if (at && c.dropAt?.test(at)) {
      log('warn', '@' + at, rule.cssText.slice(0, 48), 'at-rule is ignored');
      parent.deleteRule(i);
    } else if (rule.selectorText && c.dropSelector?.test(rule.selectorText)) {
      log('warn', rule.selectorText, '', 'selector is not understood');
      parent.deleteRule(i);
    } else {
      // a style rule carries both: own declarations and, with CSS nesting, child rules
      if (rule.style) cleanStyle(rule.style, c, rule.selectorText ?? '@' + at, log);
      if (rule.cssRules) cleanRules(rule.cssRules, rule, c, log);
    }
  }
};

const cleanSheet = (css, c, log) => {
  // replaceSync never keeps @import, so it is reported instead of parsed
  if (/@import\b/i.test(css)) log(c.linkedCss ? 'info' : 'error', '@import', '', c.linkedCss ? 'not resolved in this preview' : 'external stylesheets are not loaded');
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(css);
  cleanRules(sheet.cssRules, sheet, c, log);
  return [...sheet.cssRules].map(r => r.cssText).join('\n');
};

// Every client blocks these outright, no profile says otherwise.
const blocked = 'script,iframe,object,embed,base,xml,meta[http-equiv=refresh i]';
const unsafeUrl = /^\s*(javascript|vbscript|data:text\/html)/i;

const sanitize = (doc, log) => {
  for (const el of doc.querySelectorAll(blocked)) {
    log('error', `<${el.localName}>`, '', 'blocked by every mail client');
    el.remove();
  }
  for (const el of doc.querySelectorAll('*')) {
    for (const { name, value } of [...el.attributes]) {
      if (/^on/i.test(name)) {
        el.removeAttribute(name);
        log('error', `<${el.localName} ${name}>`, '', 'mail has no scripting');
      } else if (/^(href|src|action)$/i.test(name) && unsafeUrl.test(value)) {
        el.setAttribute(name, '#');
        log('error', `<${el.localName} ${name}>`, value.slice(0, 32), 'unsafe scheme is neutralised');
      }
    }
  }
};

const cleanElements = (doc, c, log) => {
  for (const el of doc.body.querySelectorAll('*')) {
    if (!el.isConnected) continue;
    if (c.dropEl?.test(el.localName)) {
      log('error', `<${el.localName}>`, '', 'element is removed');
      el.remove();
    } else if (c.unwrapEl?.test(el.localName)) {
      log('warn', `<${el.localName}>`, '', 'element is dropped, its content stays');
      el.replaceWith(...el.childNodes);
    } else if (/^[wo]:/.test(el.localName)) {
      el.replaceWith(...el.childNodes);
    }
  }
};

const cleanSheets = (doc, c, log) => {
  for (const el of doc.querySelectorAll('style, link[rel~=stylesheet i]')) {
    if (el.localName === 'link') {
      if (c.linkedCss) continue;
      log('error', '<link rel=stylesheet>', el.getAttribute('href') ?? '', 'external stylesheets are not loaded');
      el.remove();
    } else if (c.noStyleTags) {
      log('error', '<style>', '', 'the client keeps inline styles only');
      el.remove();
    } else {
      el.textContent = cleanSheet(el.textContent, c, log);
    }
  }
};

const px = v => parseFloat(v) || 0;
const child = (el, name) => el.querySelector(`:scope > v\\:${name}`);

const vmlShape = (el, doc, log) => {
  const attr = n => el.getAttribute(n);
  const box = doc.createElement('div');
  const s = parseDeclarations(attr('style') ?? '');
  s.setProperty('box-sizing', 'border-box');

  const fill = child(el, 'fill');
  if (fill?.getAttribute('type') === 'gradient') {
    s.setProperty('background-image', `linear-gradient(${180 - px(fill.getAttribute('angle'))}deg,${fill.getAttribute('color')},${fill.getAttribute('color2')})`);
  } else if (fill?.getAttribute('type') === 'frame') {
    s.setProperty('background', `url(${fill.getAttribute('src')}) center/cover`);
  } else {
    s.setProperty('background', fill?.getAttribute('color') ?? attr('fillcolor') ?? 'transparent');
  }
  s.setProperty('border', attr('stroke') === 'f' ? '0' : `1px solid ${attr('strokecolor') ?? '#000'}`);

  if (el.localName === 'v:oval') s.setProperty('border-radius', '50%');
  if (el.localName === 'v:roundrect') {
    const raw = attr('arcsize') ?? '0';
    const arc = px(raw) / (raw.includes('%') ? 100 : 1);
    s.setProperty('border-radius', arc * Math.min(px(s.width), px(s.height)) + 'px');
  }
  if (/v-text-anchor\s*:\s*middle/.test(attr('style') ?? '')) {
    s.cssText += ';display:flex;align-items:center;justify-content:center';
  }

  const textbox = child(el, 'textbox');
  const inset = textbox?.getAttribute('inset');
  if (inset) s.setProperty('padding', inset.split(',').map(v => v.trim() || '0').join(' '));

  box.setAttribute('style', s.cssText);
  box.append(...[...el.childNodes].filter(n => !n.localName?.startsWith('v:')));
  if (textbox) box.append(...textbox.childNodes);

  if (attr('href')) {
    const a = doc.createElement('a');
    a.setAttribute('href', attr('href'));
    a.setAttribute('style', 'text-decoration:none');
    a.append(box);
    el.replaceWith(a);
  } else {
    el.replaceWith(box);
  }
  log('info', `<${el.localName}>`, attr('fillcolor') ?? '', 'VML rendered');
};

const applyVml = (doc, mso, log) => {
  for (const el of [...doc.body.querySelectorAll('*')].filter(e => e.localName.startsWith('v:'))) {
    if (!el.isConnected) continue;
    if (!mso) {
      log('error', `<${el.localName}>`, '', 'VML renders in the Word engine only');
      el.remove();
    } else if (el.localName === 'v:image') {
      const img = doc.createElement('img');
      img.setAttribute('src', el.getAttribute('src'));
      img.setAttribute('style', el.getAttribute('style') ?? '');
      el.replaceWith(img);
      log('info', '<v:image>', el.getAttribute('src'), 'VML rendered');
    } else if (/^v:(roundrect|rect|shape|oval|background)$/.test(el.localName)) {
      vmlShape(el, doc, log);
    }
  }
};

const styleTag = (doc, css) => Object.assign(doc.createElement('style'), { textContent: css });

export class EmailClientSimulator {
  #source;

  /** @param {string} source mail HTML, fragment or complete document */
  constructor(source) {
    this.#source = String(source ?? '');
  }

  get source() { return this.#source; }

  /**
   * What the client does to the mail.
   * @returns {{client:object, html:string, report:{level:string, where:string, what:string, why:string}[]}}
   */
  render(client = 'outlookWord') {
    const c = profile(client);
    const report = [];
    const log = (level, where, what, why) => report.push({ level, where, what, why });

    const doc = new DOMParser().parseFromString(resolveConditionals(this.#source, c.mso ?? 0), 'text/html');
    sanitize(doc, log);
    cleanElements(doc, c, log);
    cleanSheets(doc, c, log);
    for (const el of doc.querySelectorAll('[style]')) {
      if (el.localName.startsWith('v:')) continue; // keeps v-text-anchor & co. for applyVml
      const style = parseDeclarations(el.getAttribute('style'));
      el.setAttribute('style', cleanStyle(style, c, `<${el.localName} style>`, log));
    }
    applyVml(doc, c.mso ?? 0, log);

    if (c.defaults) doc.head.prepend(styleTag(doc, c.defaults));
    if (c.quirks) doc.body.append(styleTag(doc, c.quirks));

    const html = /<html[\s>]/i.test(this.#source)
      ? doc.documentElement.outerHTML
      : doc.head.innerHTML + doc.body.innerHTML;
    return { client: c, html, report };
  }

  /** What the mail should fix for this client. Reads the source, changes nothing. */
  check(client = 'outlookWord') {
    const c = profile(client);
    const report = [];
    const log = (level, where, what, why) => report.push({ level, where, what, why });
    const src = this.#source;
    const doc = new DOMParser().parseFromString(src, 'text/html');

    const kb = n => Math.round(n / 1024) + ' KB';
    const bytes = new TextEncoder().encode(src).length;
    if (c.maxBytes && bytes > c.maxBytes) log('error', 'size', kb(bytes), `the mail is clipped above ${kb(c.maxBytes)}`);

    const images = [...doc.images];
    const noAlt = images.filter(i => !i.hasAttribute('alt'));
    if (noAlt.length) log('warn', '<img alt>', `${noAlt.length}x`, 'blocked images show nothing without alt text');

    if (c.mso) {
      const noWidth = images.filter(i => !i.hasAttribute('width'));
      if (noWidth.length) log('warn', '<img width>', `${noWidth.length}x`, 'the Word engine scales images without a width attribute badly');
      if (doc.body.children.length && !doc.querySelector('table')) log('warn', 'layout', '', 'the Word engine needs a table layout');
      if (/background(-image)?\s*:[^;"']*(url\(|gradient\()/i.test(src) && !/<v:/i.test(src)) log('warn', 'background-image', '', 'needs a VML fallback in Outlook');
    }
    if (c.noStyleTags && doc.querySelector('style')) log('error', '<style>', '', 'styles must be inlined for this client');
    return report;
  }
}
