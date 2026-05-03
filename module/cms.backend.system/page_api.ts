/**
 * cms.backend.system/page_api.ts
 * Port of cms.backend.system/page_api.php
 */

// deno-lint-ignore-file no-explicit-any

import type { Node } from "../cms/lib/Node.ts";
import { getTypes } from "./health_check.ts";

export default async function (node: Node, vars: any): Promise<any> {
  if (!vars?.solve_health_item) return;

  const app = node.app as any;
  const types = await getTypes(app);

  const { type, item, solution, formData } = vars.solve_health_item;

  const checkFn = types[type]?.[item];
  if (!checkFn) return { done: false, response: "check not found" };

  const data = await checkFn();
  if (!data) return { done: false, response: "check returned no data" };

  const solveFn = data.solutions?.[solution]?.solve;
  if (!solveFn) return { done: false, response: "solution not found" };

  const response = await solveFn(formData);
  return { done: true, response };
}
