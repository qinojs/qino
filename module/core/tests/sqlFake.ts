// deno-lint-ignore-file no-explicit-any
import { Sql, sql, isTemplate } from "../deps.ts";

/** Render a tag / fragment / legacy-string db call to MySQL-style [sql, params] for test fakes. */
export function fakeRender(a: any, rest: any[]): [string, unknown[]] {
  let frag: Sql;
  if (isTemplate(a)) frag = sql(a, ...rest);
  else if (a instanceof Sql) frag = a;
  else return [a, (rest[0] as unknown[]) ?? []];
  let text = "";
  const params: unknown[] = [];
  for (const p of frag.parts) {
    if ("text" in p) text += p.text;
    else if ("id" in p) text += "`" + p.id + "`";
    else { params.push(p.param); text += "?"; }
  }
  return [text, params];
}
