
import { fileURLToPath } from "node:url";
import { fs } from "@qino/qino";

import { renderTemplateFile } from "./mod.ts";

import type { Module } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

const read = (source: URL) => source.protocol === "file:" ? fs.text(fileURLToPath(source)) : fetch(source).then((r) => r.text());
const write = (path: string, content: string) => fs.write(path, content, { createNew: true }).catch(() => {});

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
      if (await fs.stat(mod.data)) return;
      await fs.mkdir(`${mod.data}pub/`);
      await write(this.file, await read(this.shipped));
      await write(this.css, css);
    },

    /** The site's copy, else what the module ships. */
    async render(node: Node) {
      return await renderTemplateFile(this.file, node) ?? await renderTemplateFile(this.shipped, node) ?? "<div></div>";
    },
  };
}
