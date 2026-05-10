/**
 * qgEntries.ts - Global entry accessor functions
 * Port of core/lib/qgEntries.php
 */


import { DbEntry, registerEntryClass } from "./DbEntry.ts";

// === dbEntry_usr ===
class dbEntry_usr extends DbEntry {
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
class dbEntry_log extends DbEntry {
  async sess(): Promise<any> {
    const id = await this.get("sess_id");
    return this._T.db.table("sess").Entry(id);
  }
}


// === dbEntry_sess ===
class dbEntry_sess extends DbEntry {
  async user(): Promise<any> {
    const id = await this.get("usr_id")
    return this._T.db.table("usr").Entry(id);
  }
}

// === dbEntry_client ===
class dbEntry_client extends DbEntry {
  async users(): Promise<Record<string, any>> {
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
class dbEntry_client_usr extends DbEntry {
  async user(): Promise<any> {
    const id = await this.get("usr_id");
    return this._T.db.table("usr").Entry(id);
  }
}

registerEntryClass("usr", dbEntry_usr);
registerEntryClass("log", dbEntry_log);
registerEntryClass("sess", dbEntry_sess);
registerEntryClass("client", dbEntry_client);
registerEntryClass("client_usr", dbEntry_client_usr);

export type { dbEntry_usr, dbEntry_log, dbEntry_sess, dbEntry_client, dbEntry_client_usr };

