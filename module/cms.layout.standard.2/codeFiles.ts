import { fileURLToPath } from "node:url";
import { fs, getCtx } from "@qino/qino";
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

/** App-wide layout files; site JavaScript replaces the shipped navigation script. */
export function codeFiles(node: Node) {
  const mod = node.module!;
  const template = moduleTemplate(mod);
  return {
    src: template.file,
    css: template.css,
    js: `${mod.data}pub/main.js`,
    shipped: template.shipped,

    /** First edit creates the template/CSS once; explicitly opening a file creates that file. */
    async create(key?: "src" | "css" | "js") {
      if (!key) return template.create(INITIAL_CSS);
      if (await fs.isFile(this[key])) return;
      const content = key === "css" ? INITIAL_CSS : await read(key === "src" ? template.shipped : new URL("pub/navigation.js", mod.source));
      await fs.mkdir(`${mod.data}pub/`);
      await fs.write(this[key], content, { createNew: true }).catch(async (error) => {
        if (!await fs.isFile(this[key], { ttl: 0 })) throw error;
      });
    },

    /** Called after u2; content modules may add their own assets afterward. */
    async addAssets() {
      const html = getCtx().res.html;
      const layoutCss = mod.modUrl + "pub/main.css";
      const siteCss = mod.dataUrl + "pub/main.css";
      html.styles.delete(layoutCss);
      html.styles.delete(siteCss);
      html.styles.add(layoutCss);
      if (await fs.isFile(this.css)) html.styles.add(siteCss);
      const shippedJs = mod.modUrl + "pub/navigation.js";
      const siteJs = mod.dataUrl + "pub/main.js";
      html.scripts.delete(shippedJs);
      html.scripts.delete(siteJs);
      html.scripts.add(await fs.isFile(this.js) ? siteJs : shippedJs);
    },
  };
}
