export type XmlNode = { tag: string; attrs: Record<string, string>; children: XmlNode[] };

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", nbsp: " " };
const decode = (s: string) => s.replace(/&(#?\w+);/g, (m, e) => ENTITIES[e] ?? m);

/** Minimal XML parser for CMS subpage definitions (elements + attributes only). */
export function parseXml(xml: string): XmlNode | null {
  const tagRe = /<(\/?)([\w.-]+)((?:\s+[\w.:-]+="[^"]*")*)\s*(\/?)>/g;
  const attrRe = /([\w.:-]+)="([^"]*)"/g;
  const root: XmlNode = { tag: "", attrs: {}, children: [] };
  const stack = [root];
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(xml))) {
    const [, close, tag, attrStr, selfClose] = m;
    if (close) { if (stack.length > 1) stack.pop(); continue; }
    const node: XmlNode = { tag, attrs: {}, children: [] };
    let a: RegExpExecArray | null;
    while ((a = attrRe.exec(attrStr))) node.attrs[a[1]] = decode(a[2]);
    stack.at(-1)!.children.push(node);
    if (!selfClose) stack.push(node);
  }
  return root.children[0] ?? null;
}
