import { cmsInstances } from "../lib/CMS.ts";

/** Binds a stand-in CMS to a (usually faked) app, so `cms(app)` resolves in tests. */
// deno-lint-ignore no-explicit-any
export const fakeCms = (app: object, fake: any): void => void cmsInstances.set(app, fake);
