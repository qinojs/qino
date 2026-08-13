import { html, type App, type HtmlString, sql, type Sql, sqlSearch } from "@qino/qino";

/** Badges "n × view / edit / administer" for the access widget heads. */
export async function accessCounts(app: App, table: string, pageId: number | string): Promise<string> {
  const all = await app.db.row`SELECT sum(if(access=1,1,0)) as access_1, sum(if(access=2,1,0)) as access_2, sum(if(access=3,1,0)) as access_3
    FROM ${sql.id(table)} WHERE page_id = ${pageId}`;
  let out = "";
  for (const level of [1, 2, 3]) {
    const n = all?.["access_" + level];
    if (n) out += `<span class="-info -access-${level}-bg">${n}</span>`;
  }
  return out;
}

/** Shared WHERE-tail of the usr/grp access lists: all rows, search hits or only granted ones. */
export function accessTail(hasMany: boolean, search: string, searchCols: string[]): Sql {
  if (!hasMany) return sql` ORDER BY a.access DESC `;
  if (!search) return sql` AND NOT ISNULL(a.access) ORDER BY a.access DESC `;
  const sh = sqlSearch(search, searchCols);
  return sql` AND ${sh.where} ORDER BY ${sh.order}`;
}

/** Table shell of the usr/grp access lists — one label column plus the four level columns. */
export function accessTable(app: App, kind: "Usr" | "Grp", label: unknown, rows: HtmlString): Promise<HtmlString> {
  const id = `cms${kind}AccessTable`;
  return html.async`<table id=${id} class=-styled style="width:100%">
  <thead><tr class=-vertical>
    <th style="text-align:left;width:auto">${label}
    <th><span class=-access-0>${app.t`no access`}</span>
    <th><span class=-access-1>${app.t`view`}</span>
    <th><span class=-access-2>${app.t`edit`}</span>
    <th><span class=-access-3>${app.t`administer`}</span>
  <tbody>${rows}
</table>
<style>#${id} input { display:block; margin:auto; }</style>`;
}

/** The four access radios of one row (0 none, 1 view, 2 edit, 3 administer). */
export function accessRadios(name: string, access: unknown): HtmlString {
  return html.join([0, 1, 2, 3].map(v =>
    html`<td><input ${(v ? access == v : !access) ? "checked" : ""} type=radio name=${name} value=${v}>`));
}
