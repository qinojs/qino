import { keyed, safeEqual } from "@qino/qino";

import type { App } from "@qino/qino";

/** Path segment the links live under. */
export const PATH = "s";

const STEM = 7;
const SIG = 1;

export const LEN = STEM + SIG;

// Both halves of a code are keyed: the signature so that a made-up code is recognisable without
// a query — one character catches 63 of 64 — and the target half so that nobody can test
// "is this the link to <guessed url>?" offline, where no rate limit and no score can reach them.
/** The half of the code that stands for the target. */
export const stemOf = (app: App, value: string) => keyed(app, ["shorturl.url", value], STEM);

export const sign = async (app: App, stem: string) => stem + await keyed(app, ["shorturl.code", stem], SIG);

/** Whether the code is one we ever handed out — not whether its link is still there. */
export async function valid(app: App, code: string): Promise<boolean> {
  return code.length === LEN && safeEqual(code, await sign(app, code.slice(0, -SIG)));
}

