import { grant } from "@qino/qino";

import type { Ctx } from "@qino/qino";

// The permission is in the URL, not a list in the session (file lists would add hundreds of paths).
// The key is per session; an app-wide key, once leaked, would grant write access forever.

/** Capability params for one file, bound to this session and valid for four hours. */
export function sign(ctx: Ctx, file: string): { exp: string; sig: string } {
  return grant.sign(ctx.sess, resource(file));
}

/** "expired": an old link; "forged": the signature never matched this session's key. */
export function check(ctx: Ctx, file: string, exp: unknown, sig: unknown) {
  return grant.verify(ctx.sess, resource(file), { exp, sig });
}

const resource = (file: string) => `fileEditor\0${file}`;
