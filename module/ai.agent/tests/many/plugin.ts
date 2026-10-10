import { Access } from "@qino/qino";

import type { ApiTree } from "@qino/qino";

// More tools than an agent is given at once: 24 alike, and one for logos.
export const api: ApiTree = Object.fromEntries([
  ...Array.from({ length: 24 }, (_, i) => [`tool${i}`, { get: { description: `Tool ${i}`, access: Access.PUBLIC, execute: () => i } }]),
  ["logo", { get: { description: "Draws a logo", access: Access.PUBLIC, execute: () => "drawn" } }],
]);
