import { html, type HtmlString, type Module } from "@qino/qino";
import { WRITE, type Node } from "@qino/qino/cms";
import { editorUrl } from "@qino/qino/fileEditor";
import { renderTemplateFile } from "./mod.ts";

const read = (source: URL) => source.protocol === "file:" ? Deno.readTextFile(source) : fetch(source).then((r) => r.text());
const write = (path: string, content: string) => Deno.writeTextFile(path, content, { createNew: true }).catch(() => {});

/** A module's template as a starting point: the site's own copy in the app dir beats the shipped one. */
export function moduleTemplate(mod: Module): {
  file: string;
  css: string;
  shipped: URL;
  create(css: string): Promise<void>;
  render(node: Node): Promise<string>;
} {
  return {
    file: `${mod.data}template.html`,
    css: `${mod.data}pub/main.css`, // cms links it while it exists
    shipped: new URL("template.html", mod.source),

    /** Give the site its own files, once — a file deleted later stays deleted and falls back. */
    async create(css: string) {
      if (await Deno.stat(mod.data).catch(() => null)) return;
      await Deno.mkdir(`${mod.data}pub/`, { recursive: true });
      await write(this.file, await read(this.shipped));
      await write(this.css, css);
    },

    /** The site's copy, else what the module ships. */
    async render(node: Node) {
      return await renderTemplateFile(this.file, node) ?? await renderTemplateFile(this.shipped, node) ?? "<div></div>";
    },
  };
}

/** Options panel of a layout module: the files are the layout of the whole site, so the layout page decides. */
export async function layoutOptions(node: Node): Promise<HtmlString | false> {
  const mod = node.module!;
  const layout = await node.cms.layoutPage(mod.name);
  if (await layout.access() < WRITE) return false;
  const template = moduleTemplate(mod);
  const file = editorUrl(template.file);
  if (!file) return false; // no editor module, nothing to offer
  const t = node.app.t;
  return html.async`
    <div>
      <p>${t`Edit the files of this layout:`}</p>
      <a target=_blank href="${file}">template.html</a><br>
      <a target=_blank href="${editorUrl(template.css)}">main.css</a>
    </div>`;
}
