// deno-lint-ignore-file no-explicit-any
import type { Node } from "../cms/mod.ts";
import { killProcess } from "./lib/processlist.ts";

export default async function api(node: Node, vars: any): Promise<any> {
  if (await node.access() < 2) return false; // killing needs edit access

  if ("kill" in vars) {
    const id = Number(vars.kill) || 0;
    if (id) await killProcess(node.app.db, id, !!vars.hard);
    return { ok: !!id };
  }
  return {};
}
