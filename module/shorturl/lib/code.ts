import { randB64, safeEqual, sha256b64url } from "@qino/qino";

import type { App } from "@qino/qino";

/** Path segment the links live under. */
export const PATH = "s";

export const STEM = 7;
const SIG = 1;

export const LEN = STEM + SIG;

// Both halves of a code are keyed: the signature so that a made-up code is recognisable without
// a query — one character catches 63 of 64 — and the target half so that nobody can test
// "is this the link to <guessed url>?" offline, where no rate limit and no score can reach them.
export const keyed = async (app: App, kind: string, value: string) =>
  sha256b64url(`${await secret(app)}\n${kind}\n${value}`);

export const sign = async (app: App, stem: string) => stem + (await keyed(app, "code", stem)).slice(0, SIG);

/** Whether the code is one we ever handed out — not whether its link is still there. */
export async function valid(app: App, code: string): Promise<boolean> {
  return code.length === LEN && safeEqual(code, await sign(app, code.slice(0, -SIG)));
}

// One in-flight generation per app — two parallel first links must not make two secrets.
const secrets = new WeakMap<App, Promise<string>>();

function secret(app: App) {
  return secrets.getOrInsertComputed(app, () => loadSecret(app).catch((e) => { secrets.delete(app); throw e; }));
}

async function loadSecret(app: App) {
  const stored = String(await app.settings.shorturl._secret ?? "");
  if (stored) return stored;
  const fresh = randB64(32);
  await app.settings.shorturl._secret(fresh);
  return fresh;
}
