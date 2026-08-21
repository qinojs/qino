import { $item, randB64 } from "@qino/qino";

import type { App } from "@qino/qino";

// One key for everything the module has to prove: a verification code's hash, a tracked link's
// marker. Made on first use, and never handed out — only what it keyed leaves here.

const secrets = new WeakMap<App, Promise<string>>();

/** One in-flight generation per app — two parallel first requests must not make two secrets. */
export function secret(app: App): Promise<string> {
  return secrets.getOrInsertComputed(app, () => load(app).catch((e) => { secrets.delete(app); throw e; }));
}

async function load(app: App) {
  const stored = String(await app.settings["messaging"]._secret ?? "");
  if (stored) return stored;
  const fresh = randB64(32);
  // writing goes through the raw item — on the proxy, .set would read as a child key
  await app.settings[$item].sub(["messaging"]).item("_secret").set(fresh);
  return fresh;
}
