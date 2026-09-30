import { Emitter } from "@qino/qino";

import type { App } from "@qino/qino";

// deno-lint-ignore no-explicit-any
type Host = Emitter<any>;

/** What a flow can listen to: the app and its emitters (`db`), by name. */
export const hosts = (app: App): Record<string, Host> =>
  ({ app, ...Object.fromEntries(Object.entries(app).filter(([, v]) => v instanceof Emitter)) });
