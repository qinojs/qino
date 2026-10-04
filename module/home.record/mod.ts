import { ApiError } from "@qino/qino";
import { entities } from "@qino/qino/home";

import type { App } from "@qino/qino";
import type { Entity } from "@qino/qino/home";

export async function series(app: App) {
  const rows = await app.db.query<{ provider: string; entity: string; enabled: boolean }>`SELECT * FROM home_series ORDER BY provider, entity`;
  return rows.map((row) => ({ ...row, enabled: Boolean(row.enabled) }));
}

/** Enable or stop capture; stopping keeps the series and its existing observations. */
export async function configure(app: App, provider: string, entity: string, enabled: boolean): Promise<void> {
  if (!provider || !entity || provider.length > 191 || entity.length > 191) throw new ApiError(400, "Invalid home series identity");
  await app.db.unit(() => app.db.table("home_series").ensure({ provider, entity, enabled }));
  if (enabled) await capture(app, provider, [entity]);
}

/** Capture time belongs to Qino; the original provider timestamp stays inside the stored entity. */
export async function record(app: App, provider: string, entity: Entity, time = Date.now()): Promise<void> {
  if (!Number.isSafeInteger(time) || !Number.isFinite(new Date(time).getTime())) throw new ApiError(400, "Invalid observation time");
  await app.db.unit(async () => {
    if (!await app.db.one`SELECT enabled FROM home_series WHERE provider = ${provider} AND entity = ${entity.id}`) return;
    await app.db.table("home_sample").ensure({ provider, entity: entity.id, time, data: JSON.stringify(entity) });
  });
}

/** Periodic samples cover constant states and make loss of availability visible. */
export async function capture(app: App, provider?: string, ids?: string[]): Promise<void> {
  const selected = (await series(app)).filter((row) => row.enabled && (provider === undefined || row.provider === provider) && (!ids || ids.includes(row.entity)));
  await Promise.all([...new Set(selected.map((row) => row.provider))].map(async (name) => {
    const current = await entities(app, name).catch(() => []);
    const time = Date.now();
    for (const row of selected.filter((row) => row.provider === name)) {
      const entity = current.find((entity) => entity.id === row.entity) ?? {
        id: row.entity, name: row.entity, state: null, attributes: {}, available: false,
      };
      await record(app, name, entity, time);
    }
  }));
}
