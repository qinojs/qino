// Core's own tables as row classes — data and behaviour in one object.
// Naming rule of the row layer: columns are data, methods are verbs.
import { addContact, contacts, mainContact, removeContact, setMainContact } from "./contacts.ts";
import { DbRow } from "./db/DbRow.ts";
import { unixTime } from "./util.ts";

import type { Db } from "./db/Db.ts";
import type { Row } from "./db/DbDriver.ts";

export class Usr extends DbRow {
  declare id: number;
  declare active: boolean;
  /** The login handle. Where to reach the person is `contacts`, never this. */
  declare username: string;
  declare given_name: string;
  declare family_name: string;
  declare organization: string;
  declare pw: string;
  declare superuser: boolean;
  declare lang: string;
  declare settings: string;

  #contacts?: Contacts;
  /** The verified ways to reach this person — `usr.contacts.add("email", "a@b.ch")`. */
  get contacts(): Contacts { return this.#contacts ??= new Contacts(this); }

  /** Where to reach them of one kind, bare: the main address, else the oldest — `usr.contact("email")`. */
  async contact(type: string): Promise<string | undefined> {
    const row = await this.contacts.main(type);
    return row && String(row.address);
  }

  #grps: number[] | null = null;
  /** The groups the user is in; 0 is the group everyone is in. */
  async grps(): Promise<number[]> {
    return this.#grps ??= [0, ...(await this.$table.db.col`SELECT grp_id FROM usr_grp WHERE usr_id = ${this.$id}`).map(Number)];
  }
}

/** One user's contacts, as a small namespace on the row rather than five methods beside it. */
class Contacts {
  #usr: Usr;
  constructor(usr: Usr) { this.#usr = usr; }

  get #db(): Db { return this.#usr.$table.db; }
  get #id(): number { return Number(this.#usr.$id); }

  /** All of them, or those of one kind, preferred first. */
  list(type?: string): Promise<Row[]> { return contacts(this.#db, this.#id, type); }

  /** The address to use of this kind: the preferred one, else the oldest. */
  main(type: string): Promise<Row | undefined> { return mainContact(this.#db, this.#id, type); }

  /** Take an address as proven; the first one of its kind becomes the main. */
  add(type: string, address: string): Promise<Row> { return addContact(this.#db, this.#id, type, address); }

  remove(type: string, address: string): Promise<void> { return removeContact(this.#db, this.#id, type, address); }

  setMain(type: string, address: string): Promise<Row> { return setMainContact(this.#db, this.#id, type, address); }
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
