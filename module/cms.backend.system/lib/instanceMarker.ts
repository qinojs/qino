// Instances sharing one dir overwrite each other's data/, cache/ and tmp/. Nothing in the process
// can see that, so each instance leaves a file whose mtime it keeps ticking; counting the fresh
// ones finds neighbours in other processes and on other machines too.
const BEAT = 30_000;
const FRESH = BEAT * 3;

const dirOf = (appDir: string) => appDir + "tmp/cms.backend.system/instance/";

/** Announce this instance until `signal` aborts. */
export async function markInstance(appDir: string, signal: AbortSignal): Promise<void> {
  const file = dirOf(appDir) + Deno.pid + "-" + crypto.randomUUID().slice(0, 8);
  await Deno.mkdir(dirOf(appDir), { recursive: true });
  const beat = () => Deno.writeTextFile(file, "").catch(() => {});
  await beat();
  const timer = setInterval(beat, BEAT);
  Deno.unrefTimer(timer); // never a reason to keep the process alive
  signal.addEventListener("abort", () => {
    clearInterval(timer);
    Deno.remove(file).catch(() => {});
  });
}

/** How many instances currently use that dir. More than one is a misconfiguration. Drops stale markers. */
export async function liveInstances(appDir: string): Promise<number> {
  const dir = dirOf(appDir);
  let live = 0;
  for (const entry of await Array.fromAsync(Deno.readDir(dir)).catch(() => [])) {
    const mtime = (await Deno.stat(dir + entry.name).catch(() => null))?.mtime;
    if (mtime && Date.now() - mtime.getTime() < FRESH) live++;
    else Deno.remove(dir + entry.name).catch(() => {}); // the process behind it is gone
  }
  return live;
}
