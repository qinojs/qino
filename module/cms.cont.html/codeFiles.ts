import { getCtx, isFile } from "@qino/qino";

import type { Node } from "@qino/qino/cms";

const write = (path: string, content: string) => Deno.writeTextFile(path, content, { createNew: true }).catch(() => {});

/** The code of a node, in the app dir: the source outside pub/, css and js inside — where the static route serves them. */
export function codeFiles(node: Node) {
  const mod = node.module!, id = node.id, sel = `[qcms-id="${id}"]`;
  return {
    src: `${mod.data}${id}.html`,
    css: `${mod.data}pub/${id}.css`,
    js: `${mod.data}pub/${id}.js`,

    /** Create the files with their initial content; existing files are kept. */
    async create(src: string) {
      await Deno.mkdir(`${mod.data}pub/`, { recursive: true });
      await write(this.src, src);
      await write(this.css, initialCss(sel));
      await write(this.js, initialJs(sel));
    },

    /** Add the css and js that exist to the current response. */
    async addAssets() {
      const ctx = getCtx(), html = ctx.res.html;
      if (await isFile(this.css, ctx.dev)) html.styles.add(`${mod.dataUrl}pub/${id}.css`);
      if (await isFile(this.js, ctx.dev)) html.scripts.add(`${mod.dataUrl}pub/${id}.js`);
    },
  };
}

// SelectorObserver instead of querySelectorAll: also runs for nodes inserted later (reload after edit, lazy content)
const initialJs = (sel: string) =>
  `import { SelectorObserver } from '@qino/u2/js/SelectorObserver/SelectorObserver.js';

new SelectorObserver({ on: el => {
} }).observe('${sel}');
`;

const initialCss = (sel: string) =>
`/* root-elements attributes are generated at render-time: qcms-id="385" qcms-mod="cont.html" */
${sel} { /* nesting syntax */
}\n`;
