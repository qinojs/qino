import { hee } from "../util.ts";

export class ResHtml {
  lang = "en";
  class: Set<string> = new Set();
  /** Trusted HTML appended verbatim to the document head. */
  head = "";
  title = "";
  titlePrefix = "";
  titleSuffix = "";
  meta: Record<string, string> = { viewport: "width=device-width" };
  link: Record<string, Record<string, string>> = {};
  scripts: Set<string> = new Set();
  styles: Set<string> = new Set();
  /** Inline css, emitted ahead of the stylesheets: defaults any sheet overrides. Hashed for CSP like the inline scripts. */
  inlineStyles: InlineStyles = new InlineStyles();
  legacyScripts: Set<string> = new Set();
  importMap: Map<string, string> = new Map();
  /** Inline script bodies with their attributes; `type` defaults to module. Each gets a CSP hash, which
   *  only executable code needs — data blocks can be written straight into the markup. */
  inlineScripts: InlineScripts = new InlineScripts();
  /** Trusted HTML appended verbatim to the document body. */
  content = "";
  // deno-lint-ignore no-explicit-any
  #jsData?: Record<string, any>;
  // deno-lint-ignore no-explicit-any
  get jsData(): Record<string, any> { return this.#jsData ??= {}; }

  #renderHead(): string {
    const hasScripts = this.scripts.size || this.legacyScripts.size || this.inlineScripts.size;
    let ret = '<meta charset=utf-8>\n';

    for (const [name, value] of Object.entries(this.meta)) if (value) ret += `<meta name="${hee(name)}" content="${hee(value)}">\n`;

    ret += `<title>${hee(this.titlePrefix + this.title + this.titleSuffix)}</title>\n`;

    // an import map cannot be an external file, so it joins the inline scripts and is hashed like them.
    // Only worth emitting when something can resolve against it — a classic script's dynamic import() counts.
    if (this.importMap.size && hasScripts)
      this.inlineScripts.set(jsonScript({ imports: Object.fromEntries(this.importMap) }), { type: "importmap" });

    let importmaps = "", inlinescripts = "";
    for (const [js, attr] of this.inlineScripts) {
      const tag = `<script${attrs({ type: "module", ...attr })}>${js}</script>\n`;
      if (attr.type === "importmap") importmaps += tag; else inlinescripts += tag;
    }

    ret += importmaps; // must precede anything that loads a module

    for (const [name, item] of Object.entries(this.link)) ret += `<link href="${hee(name)}"${attrs(item)}>\n`;

    ret += this.head;

    for (const css of this.inlineStyles) ret += `<style>${css}</style>\n`;

    for (const url of this.styles) ret += `<link rel=stylesheet href="${hee(url)}">\n`;

    // nothing reads it without a script — and it carries the csrf token
    if (this.#jsData && hasScripts) ret += `<script type=application/json id=qino-data>${jsonScript(this.#jsData)}</script>\n`;

    for (const url of this.legacyScripts) ret += `<script src="${hee(url)}"></script>\n`;

    for (const url of this.scripts) ret += `<script type=module src="${hee(url)}"></script>\n`;

    return ret + inlinescripts;
  }

  render(): string {
    return `<!DOCTYPE HTML>\n<html lang="${hee(this.lang)}"${this.class.size ? ` class="${hee([...this.class].join(" "))}"` : ""}>\n\t<head>${this.#renderHead()}\n\t<body>\n${this.content}\n`;
  }
}


/** Inline css blocks. `</style` is escaped on the way in — css reads it the same but it cannot end the element. */
class InlineStyles extends Set<string> {
  override add(css: string): this {
    return super.add(css.replace(/<\/style/gi, "<\\/style"));
  }
}

/** Inline scripts keyed by their body. `</script` is escaped on the way in — it reads the same to JS but cannot end the element. */
class InlineScripts extends Map<string, Record<string, string>> {
  override set(js: string, attr: Record<string, string> = {}): this {
    return super.set(js.replace(/<\/script/gi, "<\\/script"), attr);
  }
}

/** Attributes as HTML, skipping keys that aren't plain attribute names. */
const attrs = (o: Record<string, string>) =>
  Object.entries(o).map(([k, v]) => /^[a-zA-Z][\w-]*$/.test(k) ? ` ${k}="${hee(v)}"` : "").join("");

/** JSON serialized safely for inlining into a <script> element (escapes `<` so `</script>` can't break out). */
function jsonScript(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}
