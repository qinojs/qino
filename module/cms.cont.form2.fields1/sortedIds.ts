// Field order — shared by the render and the options UI.

import type { Node } from "@qino/qino/cms";

/** Field ids in display order: those listed in `sort` first, then the rest. */
export function sortedIds(node: Node): string[] {
  const all = Object.keys(node.settings.inputs);
  const sorted = String(node.settings.sort() ?? "").split(",").filter((id) => all.includes(id));
  return [...sorted, ...all.filter((id) => !sorted.includes(id))];
}
