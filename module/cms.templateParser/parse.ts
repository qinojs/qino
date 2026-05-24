export type TNode =
  | { type: "text";    value: string }
  | { type: "expr";    code: string }
  | { type: "element"; tag: string; attrs: TAttr[]; children: TNode[]; self: boolean }

export type TAttr = {
  name:  string;
  value: TNode[];  // mix of text + expr nodes
  raw:   string;   // original attribute value string
}

type Token =
  | { t: "open";  tag: string; attrs: { name: string; value: string }[]; self: boolean }
  | { t: "close"; tag: string }
  | { t: "text";  value: string }

const VOID = new Set(["area","base","br","col","embed","hr","img","input","link","meta","param","source","track","wbr"]);

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
    i = end + 1;
    tokens.push({ t: "open", tag: tag.toLowerCase(), attrs, self: self || VOID.has(tag.toLowerCase()) });
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

function parseTagContent(raw: string): { tag: string; attrs: { name: string; value: string }[] } {
  raw = raw.trim();
  const si = raw.search(/\s/);
  if (si === -1) return { tag: raw, attrs: [] };
  const attrs: { name: string; value: string }[] = [];
  const re = /([^\s=/"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw.slice(si))) !== null) attrs.push({ name: m[1], value: m[2] ?? m[3] ?? m[4] ?? "" });
  return { tag: raw.slice(0, si), attrs };
}

function parseExprs(text: string): TNode[] {
  if (!text.includes("{")) return text ? [{ type: "text", value: text }] : [];
  const nodes: TNode[] = [];
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf("{", i);
    if (open === -1) { nodes.push({ type: "text", value: text.slice(i) }); break; }
    if (open > i) nodes.push({ type: "text", value: text.slice(i, open) });
    const close = findExprClose(text, open + 1);
    nodes.push({ type: "expr", code: text.slice(open + 1, close) });
    i = close + 1;
  }
  return nodes;
}

function findExprClose(s: string, start: number): number {
  let depth = 1, inStr: string | null = null;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) { if (c === inStr && s[i - 1] !== "\\") inStr = null; }
    else if (c === '"' || c === "'" || c === "`") inStr = c;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return i;
  }
  return s.length;
}

export function parseTemplate(html: string): TNode[] {
  const stack: { tag: string; children: TNode[] }[] = [{ tag: "#root", children: [] }];
  for (const tok of tokenize(html)) {
    if (tok.t === "text") {
      stack.at(-1)!.children.push(...parseExprs(tok.value)); continue;
    }
    if (tok.t === "open") {
      const el: TNode & { type: "element" } = {
        type: "element", tag: tok.tag, self: tok.self, children: [],
        attrs: tok.attrs.map(a => ({ name: a.name, value: parseExprs(a.value), raw: a.value })),
      };
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
