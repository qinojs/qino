import { Access } from "@qino/qino";

import type { ApiTree } from "@qino/qino";

// A module's api: an agent may use it as tools.
export const api: ApiTree = {
  clock: { get: { description: "The time", access: Access.PUBLIC, execute: () => "noon" } },
};
