export type XmlNode = { tag: string; attrs: Record<string, string>; children: XmlNode[] };

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", nbsp: " " };
const decode = (s: string) => s.replace(/&(#?\w+);/g, (m, e) => ENTITIES[e] ?? m);

/** Minimal XML parser for CMS subpage definitions (elements + attributes only). */
export function parseXml(xml: string): XmlNode | null {
  const TAG_RE = /<(\/?)([\w.-]+)((?:\s+[\w.:-]+="[^"]*")*)\s*(\/?)>/g;
  const ATTR_RE = /([\w.:-]+)="([^"]*)"/g;
  const root: XmlNode = { tag: "", attrs: {}, children: [] };
  const stack = [root];
  for (const [, close, tag, attrStr, selfClose] of xml.matchAll(TAG_RE)) {
    if (close) { if (stack.length > 1) stack.pop(); continue; }
    const node: XmlNode = { tag, attrs: {}, children: [] };
    for (const [, name, value] of attrStr.matchAll(ATTR_RE)) node.attrs[name] = decode(value);
    stack.at(-1)!.children.push(node);
    if (!selfClose) stack.push(node);
  }
  return root.children[0] ?? null;
}
