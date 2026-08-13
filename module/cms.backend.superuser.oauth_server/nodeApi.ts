import { errMsg } from "@qino/qino";
import { deleteClient, saveClient } from "@qino/qino/oauth_server";

import type { Node } from "@qino/qino/cms";

/** Node access is the permission — whoever may read this backend node may manage clients here. */
export default async function api(node: Node, vars: Record<string, unknown>): Promise<unknown> {
  const app = node.app;
  try {
    if (typeof vars.delete === "string") {
      await deleteClient(app, vars.delete);
      return { ok: true, message: await app.t`Client deleted.` };
    }
    if (vars.revoke) {
      const { clientId, usrId } = vars.revoke as { clientId: string; usrId: number };
      await app.db.exec`DELETE FROM oauth_token WHERE client_id = ${clientId} AND usr_id = ${Number(usrId)}`;
      return { ok: true, message: await app.t`Access revoked.` };
    }
    if (vars.save) {
      const c = vars.save as { id?: string; name?: string; redirectUris?: string[] };
      const id = String(c.id ?? "").trim();
      if (!id) return { ok: false, message: await app.t`A client_id is required.` };
      const rejected = await saveClient(app, { id, name: c.name, redirectUris: c.redirectUris ?? [] });
      return rejected.length
        ? { ok: false, message: await app.t`Saved, but rejected: ${rejected.join(", ")}` }
        : { ok: true, message: await app.t`Saved.` };
    }
    return null;
  } catch (e) {
    return { ok: false, message: errMsg(e) };
  }
}
