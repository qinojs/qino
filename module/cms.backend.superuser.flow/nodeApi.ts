import { errMsg } from "@qino/qino";
import { run, toFlow } from "@qino/qino/sandbox.flow";

import type { Node } from "@qino/qino/cms";

type Saved = { description?: string; on?: string; tools?: string; code?: string };

/** Switch a flow on or off, or to test; save what was edited; delete it; try it on an example event. */
export default async function api(node: Node, vars: Record<string, unknown>): Promise<unknown> {
  const { db, t } = node.app, id = Number(vars.flow) || 0;
  if (!await db.one`SELECT id FROM flow WHERE id = ${id}`) return { ok: false, message: await t`No such flow` };
  try {
    if (vars.set === "active" || vars.set === "test") {
      await db.table("flow").update(id, { [vars.set]: Boolean(vars.value) });
      return { ok: true, message: await t`Saved` };
    }
    if (vars.save) {
      const { description = "", on = "", tools = "", code = "" } = vars.save as Saved;
      const [host, event] = on.split(" ");
      await db.table("flow").update(id, {
        description,
        host,
        event,
        tools: JSON.stringify(tools.split("\n").map((tool) => tool.trim()).filter(Boolean)),
        code,
      });
      return { ok: true, message: await t`Saved` }; // an active flow listens anew
    }
    if (vars.delete) return (await db.table("flow").delete(id), { ok: true, message: await t`Deleted` });
    if ("event" in vars) {
      const flow = toFlow((await db.row`SELECT * FROM flow WHERE id = ${id}`)!);
      const trace = await run(node.app, { ...flow, test: true }, JSON.parse(String(vars.event || "null")));
      return { ok: trace.end !== "error", message: JSON.stringify(trace, null, 2) };
    }
    return false;
  } catch (e) {
    return { ok: false, message: errMsg(e) };
  }
}
