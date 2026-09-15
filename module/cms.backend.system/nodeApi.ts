import { findCheck, getHealthChecks } from "./lib/healthRegistry.ts";

import type { Node } from "@qino/qino/cms";

export default async function (node: Node, vars: Record<string, unknown>): Promise<unknown> {
  const itemData = vars?.solve_health_item as Record<string, unknown> | undefined;
  if (!itemData || typeof itemData !== "object") return;

  const check = findCheck(await getHealthChecks(node.app), itemData);
  if (!check) return { done: false, response: "check not found" };

  const data = await check.run();
  if (!data) return { done: false, response: "check returned no data" };

  const solveFn = data.solutions?.[String(itemData.solution)]?.solve;
  if (!solveFn) return { done: false, response: "solution not found" };

  const { formData } = itemData;
  const response = await solveFn(formData instanceof Object ? formData as Record<string, unknown> : undefined);
  return { done: true, response };
}
