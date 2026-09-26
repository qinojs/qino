import { create } from "./lib/group.ts";
import { indexRow, removeImage } from "./lib/source.ts";

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
  const images = new Set<string>();
  const oldImages = new WeakMap<object, string>();
  let timer: ReturnType<typeof setTimeout> | undefined, busy = false;
  const run = async () => {
    timer = undefined;
    if (busy || signal.aborted) return;
    busy = true;
    try {
      while ((pending.size || images.size) && !signal.aborted) {
        if (pending.size) {
          const [key, [table, id]] = pending.entries().next().value!;
          pending.delete(key);
          try { await indexRow(app, table, id); }
          catch (e) { console.error(`ai1.embed: ${table}/${id}:`, e); }
        } else {
          const md5 = images.values().next().value!;
          images.delete(md5);
          try { await removeImage(app, md5); }
          catch (e) { console.error(`ai1.embed: file/${md5}:`, e); }
        }
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
  const oldImage = async ({ table, id, data }: DbEvents["table:update-before"], update: boolean) => {
    if (signal.aborted || table.name !== "file" || !id || !await app.settings["ai1.embed"].auto) return;
    if (update && !("md5" in data || "mime" in data)) return;
    const row = await table.selectByID(id);
    if (!row?.md5 || !String(row.mime).startsWith("image/")) return;
    oldImages.set(data, String(row.md5));
  };
  const cleanupImage = async ({ data }: DbEvents["table:update-after"]) => {
    const md5 = oldImages.get(data);
    if (!md5) return;
    oldImages.delete(data);
    await app.db.afterCommit(() => {
      images.add(md5);
      timer ??= setTimeout(run, 0);
    });
  };
  app.db.on("table:update-before", (event) => oldImage(event, true), { signal });
  app.db.on("table:delete-before", (event) => oldImage(event, false), { signal });
  app.db.on("table:update-after", cleanupImage, { signal });
  app.db.on("table:delete-after", cleanupImage, { signal });
  signal.addEventListener("abort", () => { if (timer !== undefined) clearTimeout(timer); pending.clear(); images.clear(); }, { once: true });
}
