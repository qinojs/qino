// event2 → cms.event, once: the dates of the PHP events as blocks of their nodes, the details as
// settings of the event content. The legacy tables stay as they are; what the event system does
// not hold yet lives on only there (README.md).
import { $item } from "@qino/qino";
import { cms } from "@qino/qino/cms";
import { add } from "@qino/qino/cms.event";

import type { App, Row } from "@qino/qino";

/** Old page modules → new ones. The site's own (overview.cd …) stay for the site to port. */
const MODULES: Record<string, string> = {
  "cms.cont.event2.category3": "cms.cont.event.category",
  "cms.cont.event2.default": "cms.cont.event",
  "cms.backend.event2": "cms.backend.event",
};

/** The zone PHP read and wrote all dates in, whatever the server's (v9 core/sysinit.php). */
const ZONE = "Europe/Paris";

/** PHP kept the wall time of its server; a prepared MySQL database holds it as Unix time. */
const local = (value: unknown, zone: string) => /^\d+$/.test(String(value))
  ? Temporal.Instant.fromEpochMilliseconds(Number(value) * 1000).toZonedDateTimeISO(zone).toPlainDateTime()
  : Temporal.PlainDateTime.from(String(value).replace(" ", "T"));

/** A date of PHP as a block: whole days lose their time and end after their last day; an end not after the start is none. */
export function range(date: Row, zone: string) {
  const start = local(date.start_date, zone);
  let end = local(date.end_date, zone);
  if (Temporal.PlainDateTime.compare(end, start) < 0) end = start;
  // all-day dates ended on their last day; midnight to midnight was a way to enter days without a
  // time, its end already the first day after
  const day = start.toPlainDate();
  if (Number(date.all_day)) return { start: day.toString(), end: end.toPlainDate().add({ days: 1 }).toString() };
  if ([start, end].every((time) => time.toPlainTime().equals("00:00"))) {
    const last = end.toPlainDate();
    return { start: day.toString(), end: (Temporal.PlainDate.compare(last, day) > 0 ? last : day.add({ days: 1 })).toString() };
  }
  return { start: start.toZonedDateTime(zone).toInstant().toString(), end: end.toZonedDateTime(zone).toInstant().toString() };
}

export async function install({ app }: { app: App }): Promise<void> {
  const db = app.db, tree = cms(app);
  if (!(await db.columns("event2_dates").catch(() => [])).length) return; // no event2 here
  if (await db.one`SELECT e.id FROM cms_event e JOIN event2_dates d ON d.page_id = e.node_id LIMIT 1`) return;
  await db.transaction(async () => {
    const report: string[] = [], zone = ZONE;

    // pages first: the details are settings of the new module
    const waiting: string[] = [];
    let details = 0;
    for (const [from, to] of Object.entries(MODULES)) {
      const pages = await db.col<number>`SELECT id FROM page WHERE module = ${from}`;
      if (!pages.length) continue;
      if (!app.modules.get(to)) {
        waiting.push(`${pages.length} × ${from}`);
        continue;
      }
      for (const id of pages) {
        const node = await tree.node(Number(id));
        if (!node.exists()) continue; // gone with its parent
        if (to.startsWith("cms.backend.") && await tree.nodeByModule(to)) {
          const was = await node.page();
          await (await was.parent())?.removeChild(was); // the new backend page stands already
          continue;
        }
        await node.set({ module: to });
        await node.urlsGen();
        const event = to === "cms.cont.event" && await db.row`SELECT * FROM event2 WHERE id = ${id}`;
        if (!event) continue;
        const people = await db.query`SELECT u.* FROM event2_performer p JOIN usr u ON u.id = p.usr_id WHERE p.event_id = ${id} ORDER BY p.sort`;
        const link = String(event.external_link ?? "").trim();
        await node.settings[$item].set({
          time_zone: zone,
          address_street: event.address_street ?? "", address_postal_code: event.address_postal_code ?? "",
          address_locality: event.address_locality ?? "", address_country: String(event.address_country ?? "").toUpperCase(),
          price: event.price == null || event.price === "" ? null : Number(event.price), currency: event.currency ?? "",
          performer: people.map((u) => [u.title, u.given_name ?? u.firstname, u.middlename, u.family_name ?? u.lastname].filter(Boolean).join(" ")).join(", "),
          language: event.lang ?? "", external_link: /^https?:\/\//i.test(link) ? link : "",
        });
        details++;
      }
      report.push(`${pages.length} × ${from} → ${to}`);
    }
    if (details) report.push(`${details} events with their details`);
    if (waiting.length) report.push(`left without a qino module: ${waiting.join(", ")}`);

    // dates: of every node that has some, whatever shows it (a product can be a course)
    let blocks = 0, empty = 0, lost = 0;
    for (const date of await db.query`SELECT * FROM event2_dates ORDER BY page_id, start_date, id`) {
      const node = await tree.node(Number(date.page_id));
      if (!node.exists()) { lost++; continue; }
      // PHP made a date of "now" for an event without one: the same second twice, and hardly a full minute
      if (date.start_date === date.end_date && local(date.start_date, zone).second) { empty++; continue; }
      await add(node, range(date, zone));
      blocks++;
    }
    report.push(`${blocks} dates`);
    if (empty) report.push(`${empty} placeholder dates left out`);
    if (lost) report.push(`${lost} dates of pages that are gone left out`);
    console.log(`[migrate_event2] ${report.join(", ")}`);
  });
}
