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
    async create(src = INITIAL_SRC) {
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

// Commented out on purpose: the parser strips comments, so nothing is created before you want it.
const INITIAL_SRC = `<div><!--

  at render time the cms adds qcms-id=385 qcms-mod=cont.html to this root element; css and js target it

  <!-- editable text — the tag becomes the wrapper, the inner html is the initial content
  <h2 cms-text=title>Title</h2>
  <div cms-text=main></div>
  <p cms-text=note if></p>          hidden for visitors while empty
  -->

  <!-- editable image — width/height in px, "localized" gives every language its own
  <cms-image name=image1 width=110 height=110 fit=contain />
  <cms-image name=logo width=110 height=110 localized />
  -->

  <!-- embedded content node, created on first render
  <cms-cont name=body module=cms.cont.text />
  -->

  <!-- node= targets another node: page, layout, direct parent, parent at absolute level 2 or an id
  <h1 cms-text=title node=page></h1>
  <cms-cont name=nav node=layout />
  -->

  <!-- stable internal link; an empty wrapper uses the target page title
  <a cms-link=page></a>
  <a cms-link=page cms-text=linkLabel>Read more</a>
  -->

</div>
`;
