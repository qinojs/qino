import { fs } from "@qino/qino";

// Instances sharing one dir overwrite each other's data/, cache/ and tmp/. Each instance keeps
// touching a marker file; counting fresh ones finds other processes and machines.
const BEAT = 30_000;
const FRESH = BEAT * 3;

const dirOf = (appDir: string) => appDir + "tmp/cms.backend.system/instance/";

/** Announce this instance until `signal` aborts. */
export async function markInstance(appDir: string, signal: AbortSignal): Promise<void> {
  const file = dirOf(appDir) + Deno.pid + "-" + crypto.randomUUID().slice(0, 8);
  await fs.mkdir(dirOf(appDir));
  const beat = () => fs.write(file, "").catch(() => {});
  await beat();
  const timer = setInterval(beat, BEAT);
  Deno.unrefTimer(timer); // never a reason to keep the process alive
  signal.addEventListener("abort", () => {
    clearInterval(timer);
    fs.remove(file).catch(() => {});
  });
}

/** Number of instances using that dir (more than one = misconfiguration). Removes stale markers. */
export async function liveInstances(appDir: string): Promise<number> {
  const dir = dirOf(appDir);
  let live = 0;
  for (const entry of await fs.list(dir).catch(() => [])) {
    const mtime = await fs.mtime(dir + entry.name, { ttl: 0 }); // other processes write these
    if (mtime && Date.now() - mtime < FRESH) live++;
    else fs.remove(dir + entry.name).catch(() => {}); // the process behind it is gone
  }
  return live;
}
