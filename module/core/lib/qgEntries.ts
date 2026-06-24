import { DbEntry, registerEntryClass } from "./DbEntry.ts";

// === dbEntry_usr ===
class dbEntry_usr extends DbEntry {
  #grps: number[] | null = null;

  async grps(): Promise<number[]> {
    if (this.#grps === null) {
      this.#grps = [0];
      const rows = await this.table.db.all`SELECT grp_id FROM usr_grp WHERE usr_id = ${String(this)}`;
      for (const vs of rows) {
        this.#grps.push(Number(vs.grp_id));
      }
    }
    return this.#grps;
  }
}

// === dbEntry_log ===
class dbEntry_log extends DbEntry {
  async sess(): Promise<dbEntry_sess> {
    const id = await this.get("sess_id");
    return this.table.db.table("sess").entry(id) as dbEntry_sess;
  }
}

// === dbEntry_sess ===
class dbEntry_sess extends DbEntry {
  async user(): Promise<dbEntry_usr> {
    const id = await this.get("usr_id")
    return this.table.db.table("usr").entry(id) as dbEntry_usr;
  }
}

// === dbEntry_client ===
class dbEntry_client extends DbEntry {
  async users(): Promise<Record<string, dbEntry_client_usr>> {
    const usrs: Record<string, dbEntry_client_usr> = {};
    const rows = await this.table.db.table("client_usr").selectEntries`WHERE client_id = ${String(this)} ORDER BY time DESC` as Record<string, dbEntry_client_usr>;
    for (const cuser of Object.values(rows)) {
      const usrId = await cuser.get("usr_id");
      usrs[String(usrId)] = cuser;
    }
    return usrs;
  }
  async addUsr(id: number | string): Promise<void> {
    await this.table.db.table("client_usr").ensure({
      client_id: String(this),
      usr_id: String(id),
      time: Math.floor(Date.now() / 1000),
    });
  }
}

// === dbEntry_client_usr ===
class dbEntry_client_usr extends DbEntry {
  async user(): Promise<dbEntry_usr> {
    const id = await this.get("usr_id");
    return this.table.db.table("usr").entry(id) as dbEntry_usr;
  }
}

registerEntryClass("usr", dbEntry_usr);
registerEntryClass("log", dbEntry_log);
registerEntryClass("sess", dbEntry_sess);
registerEntryClass("client", dbEntry_client);
registerEntryClass("client_usr", dbEntry_client_usr);

export type { dbEntry_usr, dbEntry_log, dbEntry_sess, dbEntry_client, dbEntry_client_usr };
