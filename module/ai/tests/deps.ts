import { aiInstances } from "../lib/AiApi.ts";

/** Binds a stand-in ai api to a (usually faked) app, so `ai(app)` resolves in tests. */
// deno-lint-ignore no-explicit-any
export const fakeAi = (app: object, fake: any): void => void aiInstances.set(app, fake);
