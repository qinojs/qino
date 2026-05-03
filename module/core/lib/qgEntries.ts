/**
 * qgEntries.ts - Global entry accessor functions
 * Port of core/lib/qgEntries.php
 */

// deno-lint-ignore-file no-explicit-any

import { getCtx } from "qg";
import { dbEntry, registerEntryClass } from "./dbEntry.ts";

// === dbEntry_usr ===
class dbEntry_usr extends dbEntry {
  #grps: number[] | null = null;

  async grps(): Promise<number[]> {
    if (this.#grps === null) {
      this.#grps = [0];
      const rows = await this._T.db.all("SELECT grp_id FROM usr_grp WHERE usr_id = ?", [String(this)]);
      for (const vs of rows) {
        this.#grps.push(parseInt(vs.grp_id));
      }
    }
    return this.#grps;
  }
}

// === dbEntry_log ===
class dbEntry_log extends dbEntry {
  async Sess(): Promise<any> {
    const sessId = await this.get("sess_id");
    return this._T.db.table("sess").Entry(sessId);
  }
}


// === dbEntry_sess ===
class dbEntry_sess extends dbEntry {
  #Usr: any = null;
  async Usr_(): Promise<any> {
    if (!this.#Usr) this.#Usr = Usr(await this.get("usr_id"));
    return this.#Usr;
  }
}

// === dbEntry_client ===
class dbEntry_client extends dbEntry {
  async Usrs(): Promise<Record<string, any>> {
    const usrs: Record<string, any> = {};
    const rows = await this._T.db.table("client_usr").selectEntries(`WHERE client_id = '${this}' ORDER BY time DESC`);
    for (const [, Usr] of Object.entries(rows)) {
      const usrId = await (Usr as any).get("usr_id");
      usrs[String(usrId)] = Usr;
    }
    return usrs;
  }
  async addUsr(id: number | string): Promise<void> {
    await this._T.db.table("client_usr").ensure({
      client_id: String(this),
      usr_id: String(id),
      time: Math.floor(Date.now() / 1000),
    });
  }
}


// === dbEntry_client_usr ===
class dbEntry_client_usr extends dbEntry {
  async Usr_(): Promise<any> {
    return Usr(await this.get("usr_id"));
  }
}


export function Usr(id: number | string): dbEntry_client {
  const ctx = getCtx();
  id = parseInt(String(id));
  return ctx.app.db.table("usr").Entry(id) as dbEntry_client;
}

registerEntryClass("usr", dbEntry_usr);
registerEntryClass("log", dbEntry_log);
registerEntryClass("sess", dbEntry_sess);
registerEntryClass("client", dbEntry_client);
registerEntryClass("client_usr", dbEntry_client_usr);

export type { dbEntry_usr, dbEntry_log, dbEntry_sess, dbEntry_client, dbEntry_client_usr };

