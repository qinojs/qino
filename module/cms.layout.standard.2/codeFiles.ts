import { fileURLToPath } from "node:url";
import { fs } from "@qino/qino";
import { moduleTemplate } from "@qino/qino/cms.templateParser";

import type { Node } from "@qino/qino/cms";

const INITIAL_CSS = `/* Site styles. Identity supplies the brand until overridden here. */
html {
  /* --color: #fa349a; */
  /* --font-1: system-ui, sans-serif; */
  /* --width: 50rem; */ /* Header, footer and sections; main remains full width. */
}
#container {
  #head {}
  #content {}
  #foot {}
}
`;

const read = (source: URL) => source.protocol === "file:" ? fs.text(fileURLToPath(source)) : fetch(source).then((r) => {
  if (!r.ok) throw new Error(`Cannot read ${source}: ${r.status}`);
  return r.text();
});

/** The app-wide layout files: shared by every page using the layout. */
export function codeFiles(node: Node) {
  const template = moduleTemplate(node.module!);
  return {
    html: template.file,
    css: template.css,

    /** The site's copy once, on first edit; a file deleted later stays deleted and falls back. */
    create: () => template.create(INITIAL_CSS),

    /** The site's file, else its starting point. */
    async read(key: "html" | "css") {
      if (await fs.isFile(this[key])) return fs.text(this[key]);
      return key === "css" ? INITIAL_CSS : read(template.shipped);
    },

    /** Opening a missing file in the editor writes its starting point first. */
    async open(key: "html" | "css") {
      if (await fs.isFile(this[key], { ttl: 0 })) return;
      await fs.mkdir(this[key].replace(/[^/]+$/, ""));
      await fs.write(this[key], await this.read(key), { createNew: true }).catch(() => {});
    },
  };
}
