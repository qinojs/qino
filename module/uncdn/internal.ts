// Shared between mod.ts and plugin.ts, private to the module — deno.json exports only lists mod.ts.

/** Per-app state; the plugin's init binds it, uncdn() reads it. */
export const uncdnInstances = new WeakMap<object, { origins: Set<string> }>();

/** Cap per proxied asset, and the floor for the total cache limit. */
export const MAX_ASSET_BYTES = 1024 * 1024;
