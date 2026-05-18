// deno-lint-ignore-file no-explicit-any
import { schemaToDb } from "../../../deps.ts";

type FieldSchema = Record<string, any> & {
  "x-index"?: "primary" | "unique" | "fulltext" | true;
  "x-autoincrement"?: boolean;
  "x-qg-parent"?: string;
  "x-qg-parent-field"?: string;
  "x-qg-on-parent-delete"?: string;
  "x-qg-on-parent-copy"?: string;
};

type TableSchema = {
  type?: string;
  additionalProperties?: {
    type?: string;
    properties?: Record<string, FieldSchema>;
    required?: string[];
  };
};

type DatabaseSchema = {
  type?: string;
  properties?: Record<string, TableSchema>;
};

//const INDEX_TO_KEY: Record<string, string> = { primary: "PRI", unique: "UNI", fulltext: "MUL", "true": "MUL" };

export class DbSchema {
  #db: any;

  constructor(db: any) {
    this.#db = db;
  }

  async check(schema: DatabaseSchema): Promise<void> {
    await schemaToDb(schema, (sql: string) => this.#db.query(sql), { patch: true });
    this.#db.schema = schema;
    await this.#db.init();
    //await this.#syncPhysicalOptions(schema);
  }

  // async #syncPhysicalOptions(schema: DatabaseSchema): Promise<void> {
  //   for (const [tableName, tableSchema] of Object.entries(schema.properties ?? {})) {
  //     const table = this.#db.table(tableName);
  //     const fields = tableSchema.additionalProperties?.properties ?? {};
  //     for (const [fieldName, fieldSchema] of Object.entries(fields)) {
  //       const field = table.field(fieldName);
  //       if (!field) continue;

  //       // const key = keyFromSchema(fieldSchema);
  //       // if (key !== undefined) await field.setKey(key);

  //       // if (fieldSchema["x-autoincrement"] !== undefined) {
  //       //   await field.setAutoincrement(fieldSchema["x-autoincrement"] === true);
  //       // }
  //     }
  //     await table.reloadFields();
  //   }
  // }
}

// function keyFromSchema(schema: FieldSchema): string | undefined {
//   const index = schema["x-index"];
//   if (index === undefined) return undefined;
//   return INDEX_TO_KEY[String(index)];
// }
