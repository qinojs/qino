// event2 → cms.event, once: each event2 row is a cms_event row (the node is an event), its dates
// those of cms_event_date. The legacy tables stay as they are; what the event system does
// not hold yet lives on only there (README.md).
import { ApiError } from "@qino/qino";
import { cms } from "@qino/qino/cms";
import { add, set } from "@qino/qino/cms.event";

import type { App, Row } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

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

/** The details of an event2 row, as cms.event names them. */
function details(event: Row, people: Row[]) {
  const text = (v: unknown) => String(v ?? "").trim();
  return {
    address_street: text(event.address_street), address_postal_code: text(event.address_postal_code),
    address_locality: text(event.address_locality), address_country: text(event.address_country),
    price: event.price == null || event.price === "" ? null : Number(event.price), currency: text(event.currency),
    performer: people.map((u) => [u.title, u.given_name ?? u.firstname, u.middlename, u.family_name ?? u.lastname].filter(Boolean).join(" ")).join(", "),
    language: text(event.lang), external_link: text(event.external_link),
  };
}

/** Stores what cms.event takes; a detail it refuses (a malformed link, an unknown language) is left out, the event stays. */
async function store(node: Node, values: Record<string, unknown>) {
  const refused = (e: unknown) => { if (!(e instanceof ApiError)) throw e; };
  await set(node, values).catch(async (e) => {
    refused(e);
    for (const [key, value] of Object.entries(values)) await set(node, { [key]: value }).catch(refused);
  });
}

/** PHP made a date of "now" for an event without one: the same second twice, and hardly a full minute. */
const placeholder = (date: Row, zone: string) => date.start_date === date.end_date && local(date.start_date, zone).second !== 0;

export async function install({ app }: { app: App }): Promise<void> {
  const db = app.db, tree = cms(app);
  if (!(await db.columns("event2_dates").catch(() => [])).length) return; // no event2 here
  if (await db.one`SELECT d.id FROM cms_event_date d JOIN event2 e ON e.id = d.event_id LIMIT 1`) return;
  await db.transaction(async () => {
    const report: string[] = [], zone = ZONE;
    await app.settings["cms.event"].time_zone(zone); // the zone of every event without its own

    // pages: the event modules under their new names
    const waiting: string[] = [];
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
      }
      report.push(`${pages.length} × ${from} → ${to}`);
    }
    if (waiting.length) report.push(`left without a qino module: ${waiting.join(", ")}`);

    // events: an event2 row made its page one, whatever module shows it (a product can be a course) —
    // unless it has nothing: PHP made one for every product its course category showed (makeIfNot)
    const dated = new Set((await db.query`SELECT * FROM event2_dates`).filter((date) => !placeholder(date, zone)).map((date) => Number(date.page_id)));
    let events = 0, traces = 0;
    for (const event of await db.query`SELECT * FROM event2`) {
      const node = await tree.node(Number(event.id));
      if (!node.exists()) continue;
      const people = await db.query`SELECT u.* FROM event2_performer p JOIN usr u ON u.id = p.usr_id WHERE p.event_id = ${event.id} ORDER BY p.sort`;
      const values = details(event, people);
      // the currency PHP gave every row by default says nothing on its own
      const { currency: _, ...said } = values;
      if (!dated.has(node.id) && !Object.values(said).some((v) => v != null && v !== "")) { traces++; continue; }
      await store(node, values);
      events++;
    }
    report.push(`${events} events`);
    if (traces) report.push(`${traces} empty event2 rows left out`);

    // dates: of every event; one without an event2 row becomes one with its first date
    let dates = 0, empty = 0, lost = 0;
    for (const date of await db.query`SELECT * FROM event2_dates ORDER BY page_id, start_date, id`) {
      const node = await tree.node(Number(date.page_id));
      if (!node.exists()) { lost++; continue; }
      if (placeholder(date, zone)) { empty++; continue; }
      await add(node, range(date, zone));
      dates++;
    }
    report.push(`${dates} dates`);
    if (empty) report.push(`${empty} placeholder dates left out`);
    if (lost) report.push(`${lost} dates of pages that are gone left out`);
    console.log(`[migrate_event2] ${report.join(", ")}`);
  });
}
