// The run itself: what the seeders share, and the order they run in.
import { unixTime } from "@qino/qino";
import { cms } from "@qino/qino/cms";

import { Rnd } from "./rnd.ts";
import * as ledger from "./ledger.ts";
import { seeders } from "./seeders.ts";

import type { App, Db } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

/** One demo run. Seeders write through it, and hand each other what they created. */
export class Seed {
  app: App;
  db: Db;
  rnd: Rnd;
  /** How much of everything — 1 is a site one can read, 5 one that has to scroll. */
  scale: number;
  now: number = unixTime();
  counts: Record<string, number> = {};

  /** Handed on between seeders. */
  grps = new Map<string, number>();
  usrs: { id: number; email: string; firstname: string; lastname: string }[] = [];
  pages: Node[] = [];
  root?: Node;

  constructor(app: App, { scale = 1, seed = 0x1a2b3c4d }: { scale?: number; seed?: number } = {}) {
    this.app = app;
    this.db = app.db;
    this.rnd = new Rnd(seed);
    this.scale = scale;
  }

  /** The site's public address without a trailing slash; a placeholder while `core.url` is unset. */
  async url(): Promise<string> { return (await this.app.url().catch(() => "http://localhost/")).replace(/\/$/, ""); }
  /** Round a base amount to the run's scale, at least one. */
  many(base: number): number { return Math.max(1, Math.round(base * this.scale)); }
  count(kind: string, n = 1): void { this.counts[kind] = (this.counts[kind] ?? 0) + n; }
  /** Does this installation have the table / the linked module? Seeders skip what is not there. */
  table(name: string): boolean { return !!this.db.tables[name]; }
  module(name: string): boolean { return !!this.app.modules.linked(name); }
}

/** Fill the app with demo data, replacing what an earlier run left behind. */
export async function reset(app: App, opts: { only?: string[]; scale?: number; seed?: number } = {}): Promise<Seed> {
  await wipe(app);
  const seed = new Seed(app, opts);
  const rows: ledger.Rows = [];
  const chosen = seeders.filter((s) => !opts.only || opts.only.includes(s.name));
  try {
    await ledger.record(app.db, rows, async () => {
      for (const seeder of chosen) {
        if (seeder.needs?.some((t) => !seed.table(t))) continue;
        await seeder.run(seed);
      }
    });
  } finally {
    // Even a failed run has written rows — the ledger is what makes them removable.
    await ledger.write(app, { time: seed.now, rows, counts: seed.counts, root: seed.root?.id });
  }
  return seed;
}

/** Remove everything the last run wrote, and nothing else. */
export async function wipe(app: App): Promise<number> {
  const { rows } = await ledger.read(app);
  const gone = await ledger.drop(app, rows);
  await ledger.forget(app);
  cms.get(app)?.clearCache(); // node objects still point at pages that are gone
  return gone;
}
