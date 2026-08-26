// Public API of social. The qino plugin lives in ./plugin.ts.
import { errMsg, requestStorage, sha256b64url, sql, unixTime } from "@qino/qino";

import type { App, Row } from "@qino/qino";

const MAX_ATTEMPTS = 3;
const retryAfter = (attempts: number) => 60 * 4 ** (attempts - 1);

export type Target = { provider: string; id: string; label: string; url?: string };

export type Post = {
  target: string;
  id: string;
  text: string;
  parentId?: string;
  own?: boolean;
  url?: string;
  authorId?: string;
  authorName?: string;
  time?: number;
};

export type Provider = {
  name: string;
  targets(app: App): Promise<Omit<Target, "provider">[]>;
  publish(app: App, target: string, text: string, key: string): Promise<Post>;
  sync?(app: App, target: string): Promise<Post[]>;
};

/** A provider failure worth retrying. `retryAfter` overrides the default backoff. */
export class ProviderError extends Error {
  retryAfter: number | undefined;
  constructor(message: string, retryAfter?: number) {
    super(message);
    this.retryAfter = retryAfter;
  }
}

/** Every provider declared by a linked module. */
function providers(app: App): Provider[] {
  return app.modules.linked().filter((mod) => mod.plugin.socialProvider).map((mod) => mod.plugin.socialProvider as Provider);
}

function provider(app: App, name: string): Provider | undefined {
  return providers(app).find((p) => p.name === name);
}

/** Every target the connected providers currently offer. */
export async function targets(app: App): Promise<Target[]> {
  return (await Promise.all(providers(app).map(async (provider) => {
    try { return (await provider.targets(app)).map((target) => ({ ...target, provider: provider.name })); }
    catch (e) {
      console.warn(`social.${provider.name}: targets failed —`, errMsg(e));
      return [];
    }
  }))).flat();
}

/** Publish plain text to one or more provider targets. Each target is journalled and attempted independently. */
export async function publish(app: App, to: Target | Target[], text: string): Promise<Row[]> {
  if (!text) throw new Error("social.publish needs text");
  const destinations = [...new Map([to].flat().map((target) => [`${target.provider}\0${target.id}`, target])).values()];
  if (!destinations.length) throw new Error("social.publish needs a target");
  const logId = await requestStorage.getStore()?.logId ?? null;
  const ids = await app.db.transaction(() => Promise.all(destinations.map((target) => {
    if (!provider(app, target.provider)) throw new Error(`social: provider not linked: ${target.provider}`);
    return app.db.table("social_post").insert({
      provider: target.provider,
      target: target.id,
      own: true,
      text,
      due: unixTime(),
      attempts: 0,
      log_id: logId,
    });
  })));
  await Promise.all(ids.map((id) => send(app, Number(id))));
  return app.db.query`SELECT * FROM social_post WHERE ${sql.in("id", ids.map(Number))} ORDER BY id`;
}

/** Import posts a provider authenticated and normalized. Repeated observations update one row. */
export async function ingest(app: App, providerName: string, remote: Post[]): Promise<number> {
  let added = 0;
  const table = app.db.table("social_post");
  for (const post of remote) {
    const hash = await hashOf(providerName, post);
    const known = await app.db.one`SELECT id FROM social_post WHERE hash = ${hash}`;
    const values = valuesOf(post, hash);
    if (known) await table.update(known, values);
    else {
      await table.insert({ provider: providerName, attempts: 0, ...values });
      added++;
    }
  }
  return added;
}

/** Pull all or selected connected targets. Providers without pull sync simply have no `sync`. */
export async function sync(app: App, selected?: Target | Target[]): Promise<number> {
  const list = selected ? [selected].flat() : await targets(app);
  let added = 0;
  for (const target of list) {
    const p = provider(app, target.provider);
    if (!p?.sync) continue;
    try { added += await ingest(app, p.name, await p.sync(app, target.id)); }
    catch (e) { console.warn(`social.${p.name}: sync ${target.id} failed —`, errMsg(e)); }
  }
  return added;
}

/** Known remote posts, newest first. */
export function posts(app: App, filter: { provider?: string; target?: string; sent?: boolean; limit?: number } = {}): Promise<Row[]> {
  const where = [
    filter.provider ? sql`provider = ${filter.provider}` : null,
    filter.target ? sql`target = ${filter.target}` : null,
    filter.sent == null ? null : filter.sent ? sql`sent IS NOT NULL` : sql`sent IS NULL`,
    sql`remote_id IS NOT NULL`,
  ].flatMap((term) => term ?? []);
  return app.db.query`SELECT * FROM social_post WHERE ${sql.join(where, " AND ")} ORDER BY time DESC LIMIT ${filter.limit ?? 100}`;
}

/** Publish due rows. */
export async function outbox(app: App, limit = 100): Promise<number> {
  const ids = await app.db.col`SELECT id FROM social_post
    WHERE sent IS NULL AND due IS NOT NULL AND due <= ${unixTime()}
    ORDER BY due, id LIMIT ${limit}`;
  const done = await Promise.all(ids.map((id) => send(app, Number(id))));
  return done.filter(Boolean).length;
}

async function send(app: App, id: number): Promise<boolean> {
  const row = await app.db.row`SELECT * FROM social_post WHERE id = ${id}`;
  if (!row || row.sent != null) return false;
  const p = provider(app, String(row.provider));
  if (!p) return void await failed(app, id, new Error(`social: provider not linked: ${row.provider}`)), false;
  try {
    const post = await p.publish(app, String(row.target), String(row.text), `qino-social-${id}`);
    await attach(app, row, post);
    return true;
  } catch (e) {
    await failed(app, id, e);
    return false;
  }
}

async function attach(app: App, row: Row, post: Post): Promise<void> {
  if (post.target !== row.target) throw new Error(`social.${row.provider}: publish returned another target`);
  const hash = await hashOf(String(row.provider), post);
  const known = await app.db.one`SELECT id FROM social_post WHERE hash = ${hash}`;
  const values = { ...valuesOf(post, hash), own: true, sent: unixTime(), due: null, error: null };
  if (!known || Number(known) === Number(row.id)) return void await app.db.table("social_post").update(row.id, values);
  await app.db.transaction(async () => {
    await app.db.table("social_post").delete(known);
    await app.db.table("social_post").update(row.id, values);
  });
}

async function failed(app: App, id: number, error: unknown): Promise<void> {
  const attempts = Number(await app.db.one`SELECT attempts FROM social_post WHERE id = ${id}` ?? 0) + 1;
  const retry = error instanceof ProviderError && attempts < MAX_ATTEMPTS;
  await app.db.table("social_post").update(id, {
    attempts,
    error: errMsg(error),
    due: retry ? unixTime() + (error.retryAfter ?? retryAfter(attempts)) : null,
  });
}

const hashOf = (provider: string, post: Post) => sha256b64url(`${provider}\0${post.target}\0${post.id}`);

function valuesOf(post: Post, hash: string) {
  return {
    target: post.target,
    hash,
    remote_id: post.id,
    parent_id: post.parentId ?? null,
    own: post.own ?? false,
    text: post.text,
    url: post.url ?? null,
    author_id: post.authorId ?? null,
    author_name: post.authorName ?? null,
    time: post.time ?? unixTime(),
  };
}
