import { grant } from "@qino/qino";

import type { Ctx } from "@qino/qino";

// The capability lives in the URL, not in a list of granted paths: a rendered
// file list would otherwise write hundreds of paths into the session forever.
// The key is per session — an app-wide one would, once leaked, hand out write
// access to every file of every visitor, with nothing to expire it.

/** Capability params for one file, bound to this session and valid for four hours. */
export function sign(ctx: Ctx, file: string): { exp: string; sig: string } {
  return grant.sign(ctx.sess, resource(file));
}

/** "expired" is a stale link someone kept; "forged" means the mac never matched
 *  this session's key — nobody produces that by waiting or bookmarking. */
export type Check = grant.SessionState;

export function check(ctx: Ctx, file: string, exp: unknown, sig: unknown): Check {
  return grant.verify(ctx.sess, resource(file), { exp, sig });
}

const resource = (file: string) => `fileEditor\0${file}`;
