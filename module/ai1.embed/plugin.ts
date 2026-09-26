import { create } from "./lib/group.ts";
import { indexRow } from "./lib/source.ts";

import type { App, DbEvents } from "@qino/qino";

export { default as dbSchema } from "./dbschema.json" with { type: "json" };

export const settingsSchema = {
  properties: {
    auto: { type: "boolean", default: false, description: "Maintain text and file embeddings after database writes." },
    primary: { type: "string", default: "", description: "Primary embedding collection; the first collection is used when empty." },
    chunkChars: { type: "integer", minimum: 100, default: 4000, description: "Maximum characters per indexed text part." },
  },
};

/** Seed the initial search space without replacing a chosen collection. */
export async function install({ app }: { app: App }): Promise<void> {
  if (await app.db.one`SELECT id FROM ai1_embed_collection LIMIT 1`) return;
  await create(app, "jina-embeddings-v5-omni-small", 1024);
}

export function init(app: App, { signal }: { signal: AbortSignal }): void {
  const pending = new Map<string, [string, string]>();
  let timer: ReturnType<typeof setTimeout> | undefined, busy = false;
  const run = async () => {
    timer = undefined;
    if (busy || signal.aborted) return;
    busy = true;
    try {
      while (pending.size && !signal.aborted) {
        const [key, [table, id]] = pending.entries().next().value!;
        pending.delete(key);
        try { await indexRow(app, table, id); }
        catch (e) { console.error(`ai1.embed: ${table}/${id}:`, e); }
      }
    } finally { busy = false; }
  };
  // hm, await is not good here, it is too slow. debounced would be better, with a big enough timeout (2min) to allow multiple writes to be queued up
  const queue = async ({ table, id }: DbEvents["table:insert-after"]) => {
    if (signal.aborted || !["text_lang", "file"].includes(table.name) || !id || !await app.settings["ai1.embed"].auto) return;
    await app.db.afterCommit(() => {
      pending.set(`${table.name}\0${id}`, [table.name, String(id)]);
      timer ??= setTimeout(run, 0);
    });
  };
  app.db.on("table:insert-after", queue, { signal });
  app.db.on("table:update-after", queue, { signal });
  app.db.on("table:delete-after", queue, { signal });
  signal.addEventListener("abort", () => { if (timer !== undefined) clearTimeout(timer); pending.clear(); }, { once: true });
}
