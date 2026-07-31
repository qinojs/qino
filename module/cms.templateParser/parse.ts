export type TNode =
  | { type: "text";    value: string }
  | { type: "element"; tag: string; attrs: TAttr[]; children: TNode[]; self: boolean }

export type TAttr = {
  name:  string;
  value: string | null;  // null = bare attribute (no "=")
}

type Token =
  | { t: "open";  tag: string; attrs: TAttr[]; self: boolean }
  | { t: "close"; tag: string }
  | { t: "text";  value: string }

export const VOID = new Set(["area","base","br","col","embed","hr","img","input","link","meta","param","source","track","wbr"]);
// content is text, never markup — `if (a < b)` in a script must survive
const RAW_TEXT = new Set(["script","style","textarea"]);

function tokenize(html: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < html.length) {
    if (html[i] !== "<") {
      const start = i;
      while (i < html.length && html[i] !== "<") i++;
      tokens.push({ t: "text", value: html.slice(start, i) });
      continue;
    }
    if (html.startsWith("<!--", i)) { i = (html.indexOf("-->", i + 4) + 3) || html.length; continue; }
    if (html.slice(i, i + 9).toLowerCase() === "<!doctype") { i = html.indexOf(">", i) + 1; continue; }
    if (html[i + 1] === "/") {
      const end = html.indexOf(">", i);
      tokens.push({ t: "close", tag: html.slice(i + 2, end).trim().toLowerCase() });
      i = end + 1; continue;
    }
    const end = findTagEnd(html, i + 1);
    const raw = html.slice(i + 1, end);
    const self = raw.trimEnd().endsWith("/");
    const { tag, attrs } = parseTagContent(self ? raw.trimEnd().slice(0, -1) : raw);
    const name = tag.toLowerCase();
    i = end + 1;
    tokens.push({ t: "open", tag: name, attrs, self: self || VOID.has(name) });
    if (RAW_TEXT.has(name) && !self) {
      const close = html.toLowerCase().indexOf(`</${name}`, i);
      const to = close === -1 ? html.length : close;
      if (to > i) tokens.push({ t: "text", value: html.slice(i, to) });
      i = to;
    }
  }
  return tokens;
}

function findTagEnd(html: string, start: number): number {
  let inStr: string | null = null;
  for (let i = start; i < html.length; i++) {
    const c = html[i];
    if (inStr) { if (c === inStr) inStr = null; }
    else if (c === '"' || c === "'") inStr = c;
    else if (c === ">") return i;
  }
  return html.length - 1;
}

function parseTagContent(raw: string): { tag: string; attrs: TAttr[] } {
  raw = raw.trim();
  const si = raw.search(/\s/);
  if (si === -1) return { tag: raw, attrs: [] };
  const attrs: TAttr[] = [];
  const re = /([^\s=/"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw.slice(si))) !== null) attrs.push({ name: m[1], value: m[2] ?? m[3] ?? m[4] ?? null });
  return { tag: raw.slice(0, si), attrs };
}

export function parseTemplate(html: string): TNode[] {
  const stack: { tag: string; children: TNode[] }[] = [{ tag: "#root", children: [] }];
  for (const tok of tokenize(html)) {
    if (tok.t === "text") {
      stack.at(-1)!.children.push({ type: "text", value: tok.value }); continue;
    }
    if (tok.t === "open") {
      const el: TNode & { type: "element" } = { type: "element", tag: tok.tag, attrs: tok.attrs, self: tok.self, children: [] };
      stack.at(-1)!.children.push(el);
      if (!tok.self) stack.push({ tag: tok.tag, children: el.children });
      continue;
    }
    if (tok.t === "close") {
      while (stack.length > 1 && stack.at(-1)!.tag !== tok.tag) stack.pop();
      if (stack.length > 1) stack.pop();
    }
  }
  return stack[0].children;
}
