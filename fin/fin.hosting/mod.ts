import { sql, unixTime } from "@qino/qino";
import { subscriptions, update } from "@qino/qino/fin.subscription";

import type { App, Row } from "@qino/qino";

const table = (app: App) => app.db.table("fin_hosting_domain");

/** What a domain's subscription pays for: its registration, its hosting. Neither: anything else, a service. */
export type Kind = "domain" | "hosting";
export const KINDS: Kind[] = ["domain", "hosting"];

/** The `ref` of a subscription for a domain: `fin.hosting:example.ch/hosting`, without kind for anything else. */
export const refOf = (name: string, kind?: Kind): string => `fin.hosting:${name}${kind ? `/${kind}` : ""}`;

/** The domain and kind of a fin.hosting `ref`, or undefined. */
export function parseRef(ref: unknown): { name: string; kind?: Kind } | undefined {
  const [, name, kind] = /^fin\.hosting:([^/]+)(?:\/(domain|hosting))?$/.exec(String(ref ?? "")) ?? [];
  return name ? { name, kind: kind as Kind | undefined } : undefined;
}

/** The kind a subscription is for, or undefined. */
export const kindOf = (sub: Row): Kind | undefined => parseRef(sub.ref)?.kind;

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

/** A user's domains, or all; each alias right after the domain it is an alias of, before its subdomains. */
export async function domains(app: App, usrId?: number): Promise<Row[]> {
  const rows = usrId == null
    ? await app.db.query`SELECT * FROM fin_hosting_domain`
    : await app.db.query`SELECT * FROM fin_hosting_domain WHERE usr_id = ${usrId}`;
  // by domain (an alias by its own), the domain first, then its aliases
  const order = (d: Row) => [key(String(d.alias_of ?? d.name)), d.alias_of ? 1 : 0, key(String(d.name))] as const;
  const cmp = (x: string | number, y: string | number) => x < y ? -1 : x > y ? 1 : 0;
  return rows.sort((a, b) => {
    const [x, y] = [order(a), order(b)];
    return cmp(x[0], y[0]) || cmp(x[1], y[1]) || cmp(x[2], y[2]);
  });
}

/** Whether a subscription still runs: a period begins before its end, or it has none. */
export const running = (sub: Row): boolean => !sub.end_date || String(sub.next) < String(sub.end_date).slice(0, 10);

/** The subscriptions of a user's domains, or of all, by domain. */
export async function subscriptionsBy(app: App, usrId?: number): Promise<Map<string, Row[]>> {
  const map = new Map<string, Row[]>();
  for (const sub of await subscriptions(app, usrId)) {
    const name = parseRef(sub.ref)?.name;
    if (name) map.getOrInsertComputed(name, () => []).push(sub);
  }
  return map;
}

type Values = {
  usrId?: number | null;
  aliasOf?: string | null;
  registrar?: string | null;
  host?: string | null;
  domainFree?: boolean;
  hostingFree?: boolean;
};

/**
 * Add a domain, or change one: whose it is, what it is an alias of (one level: an alias has no
 * aliases), where it is registered and where hosted. Fields not given stay. An alias is served by
 * its domain's hosting — it has none of its own — and is its domain's customer's: a `usrId` of its
 * own does not count, its domain's owner passes on to it. Its registration may cost on its own.
 * Refused where the bills would no longer fit: another owner while the present one's subscriptions
 * still run for it. Watched by `cms.backend.domain_monitor` from then on, where that is installed.
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
  const host = values.host === undefined ? current?.host ?? null : values.host?.trim() || null;
  if (main) {
    if (main === domain) throw new Error("fin.hosting: a domain is no alias of itself");
    if (host) throw new Error(`fin.hosting: ${domain} is hosted, an alias is not`);
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
  if (values.host !== undefined) fields.host = host;
  if (values.domainFree !== undefined) fields.domain_free = values.domainFree;
  if (values.hostingFree !== undefined) fields.hosting_free = values.hostingFree;
  const time = unixTime();
  if (current) await table(app).update(domain, { ...fields, changed: time });
  else await table(app).insert({ name: domain, ...fields, created: time, changed: time });
  // its aliases are its own: they follow its owner
  if (!main && "usr_id" in fields) await app.db.exec`UPDATE fin_hosting_domain SET usr_id = ${owner ?? null}, changed = ${time} WHERE alias_of = ${domain}`;
  await watch(app, domain);
  return domain;
}

/** What we bill a domain for: its registration where we registered it (`registrar`), its hosting
 *  where we host it (`host`) — each unless free. One the customer keeps elsewhere costs us nothing. */
export const billable = (d: Row): Kind[] => [
  ...d.registrar && !d.domain_free ? ["domain" as const] : [],
  ...d.host && !d.hosting_free ? ["hosting" as const] : [],
];

/**
 * What is still to do: a domain we bill for without a customer (`customer`), or a customer's
 * without a running subscription for its registration or its hosting (`billed`, with the `kind`).
 * Empty when everything is billed.
 */
export async function open(app: App): Promise<{ domain: Row; missing: "customer" | "billed"; kind?: Kind }[]> {
  const [all, subs] = await Promise.all([domains(app), subscriptionsBy(app)]);
  const out: { domain: Row; missing: "customer" | "billed"; kind?: Kind }[] = [];
  for (const domain of all) {
    const kinds = billable(domain);
    if (!kinds.length) continue;
    if (domain.usr_id == null) {
      out.push({ domain, missing: "customer" });
      continue;
    }
    const live = (subs.get(String(domain.name)) ?? []).filter(running);
    for (const kind of kinds) if (!live.some((s) => kindOf(s) === kind)) out.push({ domain, missing: "billed", kind });
  }
  return out;
}

/** A registrar the domains are registered at, or a host they are hosted on: what it holds. */
export type Source = {
  /** Stored as the domains' `registrar`, or `host`: infomaniak, plesk:s3.example.com */
  name: string;
  /** Every domain there: a registrar's with when its registration ends (YYYY-MM-DD) where known, a
   *  host's with its aliases. */
  domains(): Promise<{ name: string; expires?: string | null; aliases?: string[] }[]>;
};

/** The sources of the linked modules, as each declares them: `export const domainRegistrars =
 *  (app) => Source[]`, `export const domainHosts = (app) => Source[]`. */
const sources = async (app: App, kind: "domainRegistrars" | "domainHosts"): Promise<Source[]> =>
  (await Promise.all(app.modules.linked().map((m) => m.plugin[kind]?.(app) ?? []))).flat();

export const registrars = (app: App): Promise<Source[]> => sources(app, "domainRegistrars");
export const hosts = (app: App): Promise<Source[]> => sources(app, "domainHosts");

/** Whether a sync brings the domain back: its registrar or its host is one of the sources. */
async function synced(app: App, d: Row): Promise<boolean> {
  const [r, h] = await Promise.all([registrars(app), hosts(app)]);
  return r.some((s) => s.name === d.registrar) || h.some((s) => s.name === d.host);
}

type Report = { name: string; found: number; added: number; gone: number; error?: string; failed?: string[] };

/**
 * Take over what the sources say. A registrar's domains are ours to register (added if new, without
 * a customer yet), with their end; a host's ours to host, each with its aliases. One no longer there
 * loses its `registrar`, or its `host` (moved away, or ended); an alias no longer there its domain.
 * A source that fails changes nothing; a domain that cannot be taken over is reported (`failed`).
 * Run daily; returns per source what it found, or why not.
 */
export async function sync(app: App, from?: { registrars?: Source[]; hosts?: Source[] }): Promise<Report[]> {
  const { registrars: r = await registrars(app), hosts: h = await hosts(app) } = from ?? {};
  const out: Report[] = [];
  for (const [field, list] of [["registrar", r], ["host", h]] as const) {
    for (const source of list) out.push(await take(app, field, source));
  }
  return out;
}

async function take(app: App, field: "registrar" | "host", source: Source): Promise<Report> {
  let list;
  try {
    list = await source.domains();
  } catch (e) {
    return { name: source.name, found: 0, added: 0, gone: 0, error: e instanceof Error ? e.message : String(e) };
  }
  const seen = new Set<string>(), aliases = new Map<string, string>(), failed: string[] = [];
  let added = 0;
  const put = async (name: string, values: Values) => {
    const fresh = !await get(app, name);
    await save(app, name, values)
      .then(() => fresh && added++, (e) => failed.push(`${name}: ${e.message.replace(/^fin\.hosting: /, "")}`));
  };
  for (const entry of list) {
    const name = normalize(entry.name);
    if (!name) continue;
    seen.add(name);
    // what a host serves is no alias
    await put(name, field === "registrar" ? { registrar: source.name } : { host: source.name, aliasOf: null });
    if (entry.expires !== undefined) await app.db.exec`UPDATE fin_hosting_domain SET expires = ${entry.expires} WHERE name = ${name}`;
    for (const alias of entry.aliases ?? []) if (normalize(alias)) aliases.set(normalize(alias), name);
  }
  for (const [alias, main] of aliases) await put(alias, { aliasOf: main, host: null });
  const time = unixTime();
  const gone = (await app.db.col`SELECT name FROM fin_hosting_domain WHERE ${sql.id(field)} = ${source.name}`)
    .map(String).filter((n) => !seen.has(n));
  for (const name of gone) await app.db.exec`UPDATE fin_hosting_domain SET ${sql.id(field)} = ${null}, changed = ${time} WHERE name = ${name}`;
  if (field === "host") {
    // the host knows its domains' aliases: one it no longer lists is none
    for (const d of await app.db.query`SELECT name, alias_of FROM fin_hosting_domain WHERE alias_of IS NOT NULL`) {
      if (seen.has(String(d.alias_of)) && aliases.get(String(d.name)) !== d.alias_of) await save(app, String(d.name), { aliasOf: null });
    }
  }
  return { name: source.name, found: seen.size, added, gone: gone.length, ...failed.length ? { failed } : {} };
}

/** Why a domain may not go: a sync brings it back, it has aliases, subscriptions still run for it,
 *  or theirs are unpaid. */
export async function blockers(app: App, name: string): Promise<("synced" | "aliases" | "running" | "unpaid")[]> {
  const domain = normalize(name);
  const row = await get(app, domain);
  const subs = (await subscriptionsBy(app)).get(domain) ?? [];
  const ids = subs.map((s) => Number(s.id));
  const unpaid = ids.length && await app.db.one`SELECT 1 FROM subscription_invoice si
    JOIN invoice i ON i.id = si.invoice_id WHERE ${sql.in("si.subscription_id", ids)} AND i.status = 'open'`;
  return [
    ...row && await synced(app, row) ? ["synced" as const] : [],
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

/** Remove every domain linked to nothing — no subscription, ended ones too, no alias either way, not
 *  hosted — that no sync brings back; returns their names. */
export async function prune(app: App): Promise<string[]> {
  const [all, subs, from] = await Promise.all([domains(app), subscriptionsBy(app), registrars(app)]);
  const mains = new Set(all.map((d) => d.alias_of));
  const names = all
    .filter((d) => !d.alias_of && !mains.has(d.name) && !d.host && !from.some((s) => s.name === d.registrar) && !subs.has(String(d.name)))
    .map((d) => String(d.name));
  for (const name of names) await table(app).delete(name);
  return names;
}

/** Bill a subscription for a domain's registration, its hosting, or anything else (no `kind`); an
 *  alias has no hosting. A domain without an owner becomes the subscription's customer's, aliases
 *  and all; one with an owner takes only their subscriptions. */
export async function link(app: App, name: string, subscriptionId: number, kind?: Kind): Promise<void> {
  const domain = await get(app, name);
  if (!domain) throw new Error(`fin.hosting: no domain ${name}`);
  if (kind === "hosting" && domain.alias_of) throw new Error(`fin.hosting: ${domain.name} is an alias, it has no hosting`);
  const sub = await app.db.row`SELECT usr_id FROM subscription WHERE id = ${subscriptionId}`;
  if (!sub) throw new Error(`fin.hosting: no subscription ${subscriptionId}`);
  if (domain.usr_id != null && Number(sub.usr_id) !== Number(domain.usr_id)) {
    throw new Error("fin.hosting: the subscription is another customer's");
  }
  await update(app, subscriptionId, { ref: refOf(String(domain.name), kind) });
  if (domain.usr_id == null) await save(app, String(domain.name), { usrId: Number(sub.usr_id) });
}

/** The subscription is for this domain no more. */
export async function unlink(app: App, name: string, subscriptionId: number): Promise<void> {
  const ref = await app.db.one`SELECT ref FROM subscription WHERE id = ${subscriptionId}`;
  if (parseRef(ref)?.name !== normalize(name)) throw new Error(`fin.hosting: subscription ${subscriptionId} is not for ${name}`);
  await update(app, subscriptionId, { ref: null });
}

/** The kind its words name — "Hosting example.ch", a plan "Domain .ch" —, or undefined. */
export const kindIn = (text: string): Kind | undefined => KINDS.find((k) => new RegExp(`\\b${k}\\b`, "i").test(text));

/**
 * A subscription named after a domain is for it — "Hosting example.ch", or a plan's subscription
 * whose name is the detail "example.ch": the domain is added as the customer's, and linked for what
 * the subscription's or its plan's name says (`kindIn`). Not where the subscription is for something
 * already, nor where the domain is another customer's.
 * Called on `subscription:save`; returns the domain it linked.
 */
export async function adopt(app: App, sub: Row): Promise<string | undefined> {
  if (sub.ref) return;
  const name = normalize(String(sub.name ?? "").trim().split(/\s+/).pop() ?? "");
  if (!name) return;
  const domain = await get(app, name);
  if (domain?.usr_id != null && Number(domain.usr_id) !== Number(sub.usr_id)) return;
  if (!domain) await save(app, name, { usrId: Number(sub.usr_id) });
  const plan = sub.plan_id ? await app.db.one`SELECT name FROM subscription_plan WHERE id = ${sub.plan_id}` : "";
  const kind = kindIn(`${sub.name} ${plan ?? ""}`);
  await link(app, name, Number(sub.id), kind === "hosting" && domain?.alias_of ? undefined : kind);
  return name;
}

/** Hand the domain to `cms.backend.domain_monitor`, if installed, to be checked from now on. */
async function watch(app: App, domain: string) {
  if (!app.modules.linked("cms.backend.domain_monitor")) return;
  const monitor = await import("@qino/qino/cms.backend.domain_monitor");
  await monitor.watch(app, domain);
}
