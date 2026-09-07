import { WRITE } from "@qino/qino/cms";
import { editorUrl } from "@qino/qino/fileEditor";

import { renderTemplateFile } from "./mod.ts";

import type { Module } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

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

/** May the current user edit this layout's files? The files are the layout of the whole site,
  * so the layout page decides — not the node the panel happens to sit on. */
export async function mayEditLayout(node: Node): Promise<boolean> {
  const layout = await node.cms.layoutPage(node.module!.name);
  return await layout.access() >= WRITE;
}

/** The layout's files as editor links. Each url is a capability for this session. */
export function layoutEditorLinks(node: Node): { name: string; url: string }[] {
  const template = moduleTemplate(node.module!);
  return [["template.html", template.file], ["main.css", template.css]]
    .map(([name, path]) => ({ name, url: editorUrl(path)! }))
    .filter((f) => f.url);
}
