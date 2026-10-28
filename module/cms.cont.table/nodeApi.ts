import type { Node } from "@qino/qino/cms";

export default async function (node: Node, vars: Record<string, unknown>): Promise<void> {
  if (await node.access() < 2) return;

  const cols = Math.min(Math.max(1, Number(node.settings.cols()) || 1), 15);
  let rows = Math.min(Math.max(1, Number(node.settings.rows()) || 1), 300);

  const { do: $do } = vars;
  const row = Number(vars.row);
  const col = Number(vars.col);

  if ($do === "rowRem") {
    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < cols; j++) {
        if (i > row) {
          const text = await node.text(`${i}_${j}`);
          for (const lang of node.app.languages.all) {
            const value = await text.lang(lang).get();
            await node.text(`${i - 1}_${j}`, lang, value);
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
          const text = await node.text(`${r}_${j}`);
          for (const lang of node.app.languages.all) {
            const value = await text.lang(lang).get();
            await node.text(`${r + 1}_${j}`, lang, value);
            await node.text(`${r}_${j}`, lang, "");
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
          const text = await node.text(`${r}_${c}`);
          for (const lang of node.app.languages.all) {
            const value = await text.lang(lang).get();
            await node.text(`${r}_${c - 1}`, lang, value);
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

}
