import { fileURLToPath } from "node:url";
import { errMsg, fs, unixTime } from "@qino/qino";

import { keep } from "./search.ts";

import type { App } from "@qino/qino";

// A module brings agents as `agents/<key>.md`, listed in its manifest's `files` (so remote modules work alike).

const read = (url: URL) => url.protocol === "file:" ? fs.text(fileURLToPath(url)) : fetch(url).then((r) => {
  if (!r.ok) throw new Error(`Cannot read ${url}: ${r.status}`);
  return r.text();
});

/** `---` front matter with one JSON value per line, then the role. */
function parse(md: string) {
  const [, head = "", body = md] = md.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/) ?? [];
  const meta = Object.fromEntries(head.split("\n").filter(Boolean).map((line) => {
    const i = line.indexOf(":");
    return [line.slice(0, i).trim(), JSON.parse(line.slice(i + 1))];
  }));
  return { meta, body: body.trim() };
}

/** The declared agents into `ai_agent`, by name `<module>/<key>`: role, tools and prefer follow the file
 *  (a copy at the same path in the module's data dir wins); memories and sessions stay with the id.
 *  Tools are not checked: the apis are mounted only after init, and unknown names give no tool. */
export async function declare(app: App): Promise<void> {
  for (const mod of app.modules.all().values()) { // all imported at init, linked or about to be
    for (const path of mod.manifest.files?.filter((f) => /^agents\/[^/]+\.md$/.test(f)) ?? []) {
      const name = `${mod.name}/${path.slice(7, -3)}`;
      try {
        const site = mod.data + path, shipped = new URL(path, mod.source);
        const { meta, body } = parse(await fs.isFile(site, { ttl: 0 }) ? await fs.text(site) : await read(shipped));
        const vs = { name, system: body, tools: JSON.stringify(meta.tools ?? []), prefer: meta.prefer ? JSON.stringify(meta.prefer) : "" };
        const row = await app.db.row`SELECT id, system FROM ai_agent WHERE name = ${name}`;
        const id = row ? Number(row.id) : Number(await app.db.table("ai_agent").insert({ ...vs, time: unixTime() }));
        if (row) await app.db.table("ai_agent").update(id, vs);
        if (row?.system !== body) keep(app, "ai_agent", { agent_id: id }, body); // findable by its role, as it is now
      } catch (e) {
        console.error(`[ai.agent] ${name}:`, errMsg(e));
      }
    }
  }
}
