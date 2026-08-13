// Core's own tables as row classes — data and behaviour in one object.
// Naming rule of the row layer: columns are data, methods are verbs.
import { DbRow } from "./db/DbRow.ts";
import { unixTime } from "./util.ts";

import type { Db } from "./db/Db.ts";

export class Usr extends DbRow {
  declare id: number;
  declare active: boolean;
  declare email: string;
  declare firstname: string;
  declare lastname: string;
  declare company: string;
  declare pw: string;
  declare superuser: boolean;
  declare lang: string;
  declare settings: string;

  #grps: number[] | null = null;
  /** The groups the user is in; 0 is the group everyone is in. */
  async grps(): Promise<number[]> {
    return this.#grps ??= [0, ...(await this.$table.db.col`SELECT grp_id FROM usr_grp WHERE usr_id = ${this.$id}`).map(Number)];
  }
}

export class Client extends DbRow {
  declare id: number;
  declare hash: string;
  declare usr_id: number;

  /** Everyone who ever signed in on this device, newest first, by user id. */
  async users(): Promise<Record<string, ClientUsr>> {
    const rows = await this.$table.db.table("client_usr").all<ClientUsr>`WHERE client_id = ${this.$id} ORDER BY time DESC`;
    return Object.fromEntries(rows.map((row) => [String(row.usr_id), row]));
  }

  async addUsr(id: number | string): Promise<void> {
    await this.$table.db.table("client_usr").ensure({ client_id: this.$id, usr_id: String(id), time: unixTime() });
  }
}

export class ClientUsr extends DbRow {
  declare client_id: number;
  declare usr_id: number;
  declare save_login: boolean;
  declare time: number;

  user(): Promise<Usr | undefined> {
    return this.$table.db.table("usr").get<Usr>(this.usr_id);
  }
}

export function registerRows(db: Db): void {
  db.table("usr").rowClass = Usr;
  db.table("client").rowClass = Client;
  db.table("client_usr").rowClass = ClientUsr;
}
