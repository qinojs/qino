import { generateVAPIDKeys } from "web-push-neo";
import { $item, type App } from "../../core/mod.ts";

// Module-internal: these details carry the private key. mod.ts exposes only the public half.

// One in-flight generation per app — parallel requests must not create two key pairs.
const keys = new WeakMap<App, Promise<{ publicKey: string; privateKey: string }>>();

/** The app's VAPID details — the key pair is generated and stored in settings on first use. */
export async function vapid(app: App): Promise<{ subject: string; publicKey: string; privateKey: string }> {
  const subject = String(await app.settings["messaging.web_push"].subject);
  const pair = await keys.getOrInsertComputed(app, () => load(app).catch((e) => { keys.delete(app); throw e; }));
  return { subject, ...pair };
}

async function load(app: App) {
  const settings = app.settings["messaging.web_push"];
  const publicKey = String(await settings.publicKey ?? "");
  const privateKey = String(await settings.privateKey ?? "");
  if (publicKey && privateKey) return { publicKey, privateKey };

  const fresh = await generateVAPIDKeys();
  // writing goes through the raw item — on the proxy, .set would read as a child key
  const node = app.settings[$item].sub(["messaging.web_push"]);
  await Promise.all([node.item("publicKey").set(fresh.publicKey), node.item("privateKey").set(fresh.privateKey)]);
  return fresh;
}
