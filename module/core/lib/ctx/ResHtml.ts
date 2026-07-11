import { hee } from "../util.ts";

export class ResHtml {
  lang = "en";
  class: Set<string> = new Set<string>();
  /** Trusted HTML appended verbatim to the document head. */
  head = "";
  title = "";
  titlePrefix = "";
  titleSuffix = "";
  meta: Record<string, string> = { viewport: "width=device-width" };
  link: Record<string, Record<string, string>> = {};
  scripts: Set<string> = new Set<string>();
  styles: Set<string> = new Set<string>();
  legacyScripts: Set<string> = new Set<string>();
  importMap: Map<string, string> = new Map<string, string>();
  /** Trusted HTML appended verbatim to the document body. */
  content = "";
  // deno-lint-ignore no-explicit-any
  #jsData?: Record<string, any>;
  // deno-lint-ignore no-explicit-any
  get jsData(): Record<string, any> { return this.#jsData ??= {}; }

  #renderHead(): string {
    let ret = '<meta charset="utf-8">\n';

    for (const [name, value] of Object.entries(this.meta)) {
      if (value === "") continue;
      ret += `<meta name="${hee(name)}" content="${hee(value)}">\n`;
    }

    ret += `<title>${hee(this.titlePrefix + this.title + this.titleSuffix)}</title>\n`;

    if (this.importMap.size) {
      ret += `<script type=importmap>${jsonScript({ imports: Object.fromEntries(this.importMap) })}</script>\n`;
    }

    for (const [name, item] of Object.entries(this.link)) {
      ret += `<link href="${hee(name)}"`;
      for (const [k, val] of Object.entries(item)) if (/^[a-zA-Z][\w-]*$/.test(k)) ret += ` ${k}="${hee(val)}"`;
      ret += ">\n";
    }

    ret += this.head;

    for (const url of this.styles) ret += `<link rel=stylesheet href="${hee(url)}">\n`;

    if (this.#jsData) ret += `<script type=json/c1>${jsonScript(this.#jsData)}</script>\n`;

    for (const url of this.legacyScripts) ret += `<script src="${hee(url)}"></script>\n`;

    for (const url of this.scripts) ret += `<script type=module src="${hee(url)}"></script>\n`;

    return ret;
  }

  render(): string {
    return `<!DOCTYPE HTML>\n<html lang="${hee(this.lang)}"${this.class.size ? ` class="${hee([...this.class].join(" "))}"` : ""}>\n\t<head>${this.#renderHead()}\n\t<body>\n${this.content}\n`;
  }
}


/** JSON serialized safely for inlining into a <script> element (escapes `<` so `</script>` can't break out). */
function jsonScript(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}
