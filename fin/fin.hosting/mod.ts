import { sql, unixTime } from "@qino/qino";
import { subscriptions, update } from "@qino/qino/fin.subscription";

import type { App, Row } from "@qino/qino";

const table = (app: App) => app.db.table("fin_hosting_domain");

/** The `ref` of the subscriptions a domain is billed by: its hosting, the domain, the service. */
export const refOf = (name: string): string => `fin.hosting:${name}`;

/** A domain as stored — lower case, punycode, without scheme, path or trailing dot — or "". */
export function normalize(value: string): string {
  const input = String(value ?? "").trim().replace(/^https?:\/\//i, "").replace(/[/?#].*$/, "").replace(/\.$/, "");
  try {
    const url = new URL(`https://${input}`);
    const host = url.hostname;
    return !url.username && !url.password && !url.port && host.length <= 191 && /^([a-z0-9](-*[a-z0-9])*\.)+([a-z]{2,}|xn--[a-z0-9-]+)$/.test(host) ? host : "";
  } catch {
    return "";
  }
}

/** Labels reversed, so a domain's aliases and subdomains follow it. */
const key = (name: string) => name.split(".").reverse().join(".");

/** One domain, or undefined. */
export const get = (app: App, name: string): Promise<Row | undefined> =>
  app.db.row`SELECT * FROM fin_hosting_domain WHERE name = ${normalize(name)}`;

/** A user's domains, or all; each alias right after the domain it is an alias of. */
export async function domains(app: App, usrId?: number): Promise<Row[]> {
  const rows = usrId == null
    ? await app.db.query`SELECT * FROM fin_hosting_domain`
    : await app.db.query`SELECT * FROM fin_hosting_domain WHERE usr_id = ${usrId}`;
  const order = (d: Row) => d.alias_of ? `${key(String(d.alias_of))}\u0000${key(String(d.name))}` : key(String(d.name));
  return rows.sort((a, b) => order(a).localeCompare(order(b)));
}

/** Whether a subscription still runs: a period begins before its end, or it has none. */
export const running = (sub: Row): boolean => !sub.end_date || String(sub.next) < String(sub.end_date).slice(0, 10);

/** The subscriptions of a user's domains, or of all, by domain. */
export async function subscriptionsBy(app: App, usrId?: number): Promise<Map<string, Row[]>> {
  const map = new Map<string, Row[]>();
  for (const sub of await subscriptions(app, usrId)) {
    const [module, name] = String(sub.ref ?? "").split(/:(.*)/);
    if (module === "fin.hosting" && name) map.getOrInsertComputed(name, () => []).push(sub);
  }
  return map;
}

type Values = { usrId?: number | null; aliasOf?: string | null; registrar?: string | null };

/**
 * Add a domain, or change one: whose it is, what it is an alias of (one level: an alias has no
 * aliases), where it is registered. Fields not given stay. An alias is served by its domain's
 * hosting and is its domain's customer's: a `usrId` of its own does not count, its domain's owner
 * passes on to it. It may have subscriptions of its own (the domain itself costs). Refused where the
 * bills would no longer fit: another owner while the present one's subscriptions still run for it.
 * Watched by `cms.backend.domain_monitor` from then on, where that is installed.
 */
export async function save(app: App, name: string, values: Values = {}): Promise<string> {
  const domain = normalize(name);
  if (!domain) throw new Error(`fin.hosting: not a domain: ${name}`);
  const current = await get(app, domain);
  const live = ((await subscriptionsBy(app)).get(domain) ?? []).filter(running);
  const fields: Record<string, unknown> = {};
  if (values.usrId !== undefined) fields.usr_id = values.usrId;
  const main = values.aliasOf === undefined ? current?.alias_of ?? null : values.aliasOf ? normalize(values.aliasOf) : null;
  if (values.aliasOf && !main) throw new Error(`fin.hosting: not a domain: ${values.aliasOf}`);
  if (main) {
    if (main === domain) throw new Error("fin.hosting: a domain is no alias of itself");
    const of = await get(app, main);
    if (!of) throw new Error(`fin.hosting: no domain ${main}`);
    if (of.alias_of) throw new Error(`fin.hosting: ${main} is an alias itself`);
    if (await app.db.one`SELECT 1 FROM fin_hosting_domain WHERE alias_of = ${domain}`) {
      throw new Error(`fin.hosting: ${domain} has aliases of its own`);
    }
    fields.usr_id = of.usr_id;
  }
  if (values.aliasOf !== undefined) fields.alias_of = main;
  const owner = "usr_id" in fields ? fields.usr_id : current?.usr_id;
  if (live.some((sub) => Number(sub.usr_id) !== Number(owner))) {
    throw new Error(`fin.hosting: the subscriptions of its owner still run for ${domain}`);
  }
  if (values.registrar !== undefined) fields.registrar = values.registrar?.trim() || null;
  const time = unixTime();
  if (current) await table(app).update(domain, { ...fields, changed: time });
  else await table(app).insert({ name: domain, ...fields, created: time, changed: time });
  // its aliases are its own: they follow its owner
  if (!main && "usr_id" in fields) await app.db.exec`UPDATE fin_hosting_domain SET usr_id = ${owner ?? null}, changed = ${time} WHERE alias_of = ${domain}`;
  await watch(app, domain);
  return domain;
}

/** Why a domain may not go: it has aliases, subscriptions still run for it, or theirs are unpaid. */
export async function blockers(app: App, name: string): Promise<("aliases" | "running" | "unpaid")[]> {
  const domain = normalize(name);
  const subs = (await subscriptionsBy(app)).get(domain) ?? [];
  const ids = subs.map((s) => Number(s.id));
  const unpaid = ids.length && await app.db.one`SELECT 1 FROM subscription_invoice si
    JOIN invoice i ON i.id = si.invoice_id WHERE ${sql.in("si.subscription_id", ids)} AND i.status = 'open'`;
  return [
    ...await app.db.one`SELECT 1 FROM fin_hosting_domain WHERE alias_of = ${domain}` ? ["aliases" as const] : [],
    ...subs.some(running) ? ["running" as const] : [],
    ...unpaid ? ["unpaid" as const] : [],
  ];
}

/** Remove a domain nothing holds on to any more (see `blockers`). Its ended subscriptions keep
 *  their `ref`: what they were for stays readable. The monitor keeps watching until told otherwise. */
export async function remove(app: App, name: string): Promise<void> {
  const why = await blockers(app, name);
  if (why.length) throw new Error(`fin.hosting: ${normalize(name)} is held: ${why.join(", ")}`);
  await table(app).delete(normalize(name));
}

/** Bill a subscription for a domain, an alias too (its registration costs). A domain without an
 *  owner becomes the subscription's customer's, aliases and all; one with an owner takes only
 *  their subscriptions. */
export async function link(app: App, name: string, subscriptionId: number): Promise<void> {
  const domain = await get(app, name);
  if (!domain) throw new Error(`fin.hosting: no domain ${name}`);
  const sub = await app.db.row`SELECT usr_id FROM subscription WHERE id = ${subscriptionId}`;
  if (!sub) throw new Error(`fin.hosting: no subscription ${subscriptionId}`);
  if (domain.usr_id != null && Number(sub.usr_id) !== Number(domain.usr_id)) {
    throw new Error("fin.hosting: the subscription is another customer's");
  }
  await update(app, subscriptionId, { ref: refOf(String(domain.name)) });
  if (domain.usr_id == null) await save(app, String(domain.name), { usrId: Number(sub.usr_id) });
}

/** The subscription is for this domain no more. */
export async function unlink(app: App, name: string, subscriptionId: number): Promise<void> {
  const ref = await app.db.one`SELECT ref FROM subscription WHERE id = ${subscriptionId}`;
  if (ref !== refOf(normalize(name))) throw new Error(`fin.hosting: subscription ${subscriptionId} is not for ${name}`);
  await update(app, subscriptionId, { ref: null });
}

/**
 * A subscription named after a domain is for it — "Hosting example.ch", or a plan's subscription
 * whose name is the detail "example.ch": the domain is added as the customer's, and linked. Not
 * where the subscription is for something already, nor where the domain is another customer's.
 * Called on `subscription:save`; returns the domain it linked.
 */
export async function adopt(app: App, sub: Row): Promise<string | undefined> {
  if (sub.ref) return;
  const name = normalize(String(sub.name ?? "").trim().split(/\s+/).pop() ?? "");
  if (!name) return;
  const domain = await get(app, name);
  if (domain?.usr_id != null && Number(domain.usr_id) !== Number(sub.usr_id)) return;
  if (!domain) await save(app, name, { usrId: Number(sub.usr_id) });
  await link(app, name, Number(sub.id));
  return name;
}

/** Hand the domain to `cms.backend.domain_monitor`, if installed, to be checked from now on. */
async function watch(app: App, domain: string) {
  if (!app.modules.linked("cms.backend.domain_monitor")) return;
  const monitor = await import("@qino/qino/cms.backend.domain_monitor");
  await monitor.watch(app, domain);
}
