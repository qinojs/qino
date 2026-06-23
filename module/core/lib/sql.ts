// deno-lint-ignore-file no-explicit-any

// Dialect-neutral SQL fragments. Build with the sql`` tag — interpolated values
// become bound parameters, nested fragments/ids compose. The driver renders the
// fragment to its dialect (placeholder + identifier quoting) at execution time.

export type SqlPart = { text: string } | { param: unknown } | { id: string };

export class Sql {
  parts: SqlPart[];
  constructor(parts: SqlPart[] = []) { this.parts = parts; }
}

export interface SqlTag {
  /** Tagged template; interpolated values become bound parameters. */
  (strings: TemplateStringsArray, ...values: unknown[]): Sql;
  /** Quote a dynamic identifier (table/column) per dialect. */
  id(name: string): Sql;
  /** Inject text verbatim — escape hatch, never pass user input. */
  raw(text: string): Sql;
  /** Join fragments with a separator (IN-lists, column sets). */
  join(frags: Sql[], separator?: string): Sql;
}

function build(strings: TemplateStringsArray, ...values: unknown[]): Sql {
  const parts: SqlPart[] = [];
  strings.forEach((s, i) => {
    if (s) parts.push({ text: s });
    if (i < values.length) {
      const v = values[i];
      if (v instanceof Sql) parts.push(...v.parts);
      else parts.push({ param: v });
    }
  });
  return new Sql(parts);
}

export const sql: SqlTag = Object.assign(build, {
  id: (name: string) => new Sql([{ id: name }]),
  raw: (text: string) => new Sql([{ text }]),
  join: (frags: Sql[], separator = ", ") => {
    const parts: SqlPart[] = [];
    frags.forEach((f, i) => {
      if (i) parts.push({ text: separator });
      parts.push(...f.parts);
    });
    return new Sql(parts);
  },
});

/** True for a tagged-template call (first arg is the template strings array). */
export function isTemplate(a: unknown): a is TemplateStringsArray {
  return Array.isArray((a as any)?.raw);
}
