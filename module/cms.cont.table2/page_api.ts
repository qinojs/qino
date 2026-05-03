// Port of cms.cont.table2/page_api.php
import type { Node } from "../cms/lib/Node.ts";

export default async function (node: Node, vars: any, self: any): Promise<void> {
  if (await node.access() < 2) return;

  let cols = Math.min(Math.max(1, parseInt(String(await node.settings.cols)) || 1), 15);
  let rows = Math.min(Math.max(1, parseInt(String(await node.settings.rows)) || 1), 300);

  const { do: $do, row, col } = vars;

  if ($do === "rowRem") {
    for (let i = 0; i < rows; i++) {
      const r = i;
      for (let j = 0; j < cols; j++) {
        if (r > row) {
          const T1 = await node.text(`${r}_${j}`);
          for (const l of node.app.languages.all) {
            const value = await T1.lang(l).get();
            await node.text(`${r - 1}_${j}`, l, value);
          }
        }
      }
    }
    node.settings.rows(rows - 1);
  }

  if ($do === "rowAddAfter") {
    ++rows;
    for (let i = 1; i < rows; i++) {
      const r = rows - 1 - i;
      for (let j = 0; j < cols; j++) {
        if (r > row) {
          const T1 = await node.text(`${r}_${j}`);
          for (const l of node.app.languages.all) {
            const value = await T1.lang(l).get();
            await node.text(`${r + 1}_${j}`, l, value);
            await node.text(`${r}_${j}`, l, "");
          }
        }
      }
    }
    node.settings.rows(rows);
  }

  if ($do === "colRem") {
    for (let i = 0; i < rows; i++) {
      const r = rows - 1 - i;
      for (let j = cols; j > 0; j--) {
        const c = cols - j;
        if (c > col) {
          const T1 = await node.text(`${r}_${c}`);
          for (const l of node.app.languages.all) {
            const value = await T1.lang(l).get();
            await node.text(`${r}_${c - 1}`, l, value);
          }
        }
      }
    }
    node.settings.cols(cols - 1);
  }

  if ($do === "colAddRight") {
    for (let i = 0; i < rows; i++) {
      const r = rows - 1 - i;
      for (let c = cols - 1; c > 0; c--) {
        if (c > col) {
          for (const lang of node.app.languages.all) {
            const textLang = await node.text(`${r}_${c}`, lang);
            const value = await textLang.get();
            await node.text(`${r}_${c + 1}`, lang, value);
            await node.text(`${r}_${c}`, lang, "");
          }
        }
      }
    }
    node.settings.cols(cols + 1);
  }

  await self.reload(String(node.id));
}
