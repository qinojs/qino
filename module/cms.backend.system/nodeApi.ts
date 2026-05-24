import type { Node } from "../cms/lib/Node.ts";
import { getTypes } from "./health_check.ts";

export default async function (node: Node, vars: Record<string, unknown>): Promise<unknown> {
  if (!vars?.solve_health_item) return;

  const app = node.app;
  const types = await getTypes(app);

  const itemData = vars.solve_health_item;
  if (!itemData || typeof itemData !== "object") return;
  const { type, item, solution, formData } = itemData as Record<string, unknown>;

  const checkFn = types[String(type)]?.[String(item)];
  if (!checkFn) return { done: false, response: "check not found" };

  const data = await checkFn();
  if (!data) return { done: false, response: "check returned no data" };

  const solveFn = data.solutions?.[String(solution)]?.solve;
  if (!solveFn) return { done: false, response: "solution not found" };

  const response = await solveFn(formData && typeof formData === "object" ? formData as Record<string, unknown> : undefined);
  return { done: true, response };
}
