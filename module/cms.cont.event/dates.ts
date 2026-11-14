import { html, sql } from "@qino/qino";

import type { Db, Sql } from "@qino/qino";
import type { Range } from "@qino/qino/calendar";

/** Join a paginated node selection to at most three date previews per event in one query. */
export async function overview(db: Db, query: Sql, order: Sql) {
  const rows = await db.query`WITH event_nodes AS (${query}), event_dates AS (
    SELECT e.node_id, e.${sql.id("start")}, e.${sql.id("end")}, e.all_day,
      COUNT(*) OVER (PARTITION BY e.node_id) AS date_count,
      MIN(e.${sql.id("start")}) OVER (PARTITION BY e.node_id) AS period_start,
      MAX(e.${sql.id("end")}) OVER (PARTITION BY e.node_id) AS period_end,
      FIRST_VALUE(e.all_day) OVER (PARTITION BY e.node_id ORDER BY e.${sql.id("start")}, e.id) AS period_start_all_day,
      FIRST_VALUE(e.all_day) OVER (PARTITION BY e.node_id ORDER BY e.${sql.id("end")} DESC, e.id) AS period_end_all_day,
      ROW_NUMBER() OVER (PARTITION BY e.node_id ORDER BY e.${sql.id("start")}, e.id) AS date_rank
    FROM cms_event e JOIN event_nodes p ON p.id = e.node_id
  ) SELECT p.*, e.${sql.id("start")} AS date_start, e.${sql.id("end")} AS date_end, e.all_day AS date_all_day, e.date_count,
      e.period_start, e.period_end, e.period_start_all_day, e.period_end_all_day
    FROM event_nodes p LEFT JOIN event_dates e ON e.node_id = p.id AND e.date_rank <= ${3}
    ORDER BY ${order}, e.date_rank`;
  const items = new Map<number, { row: (typeof rows)[number]; count: number; blocks: Range[]; period?: Range }>();
  for (const row of rows) {
    const id = Number(row.id);
    if (!items.has(id)) items.set(id, { row, count: Number(row.date_count ?? 0), blocks: [] });
    if (row.date_start == null) continue;
    const value = (seconds: unknown, allDay: unknown) => {
      const instant = Temporal.Instant.fromEpochMilliseconds(Number(seconds) * 1000);
      return allDay === true || Number(allDay) === 1 ? instant.toZonedDateTimeISO("UTC").toPlainDate().toString() : instant.toString();
    };
    const item = items.get(id)!;
    item.blocks.push({ start: value(row.date_start, row.date_all_day), end: value(row.date_end, row.date_all_day) });
    item.period ??= { start: value(row.period_start, row.period_start_all_day), end: value(row.period_end, row.period_end_all_day) };
  }
  return [...items.values()];
}

/** Locale-aware date ranges; whole days retain their dates and exclude the stored end date. */
export function formatDates(blocks: Range[], lang: string, timeZone: string) {
  const dates = new Intl.DateTimeFormat(lang, { dateStyle: "long", timeZone: "UTC" });
  const times = new Intl.DateTimeFormat(lang, { dateStyle: "long", timeStyle: "short", timeZone });
  return blocks.map((block) => {
    const startDay = !/[Tt ]/.test(block.start), endDay = !/[Tt ]/.test(block.end);
    const end = endDay ? Temporal.PlainDate.from(block.end).subtract({ days: 1 }).toString() : block.end;
    const instant = (value: string, allDay: boolean) => allDay ? Temporal.PlainDate.from(value).toZonedDateTime("UTC").epochMilliseconds
      : Temporal.Instant.from(value).epochMilliseconds;
    const from = instant(block.start, startDay), to = instant(end, endDay);
    const text = startDay === endDay ? (startDay ? dates : times).formatRange(from, to)
      : `${(startDay ? dates : times).format(from)} – ${(endDay ? dates : times).format(to)}`;
    return html`<time datetime="${block.start}">${text}</time>`;
  });
}
