import { NotFoundError } from "@qino/qino";

import type { App } from "@qino/qino";

/** A logical endpoint, not necessarily a physical device. Values and attributes keep their types. */
export type Entity = {
  id: string;
  name: string;
  state: unknown;
  attributes: Record<string, unknown>;
  available: boolean;
  updated?: string;
};

/** Actions are discovered, never inferred from an entity's name or state. */
export type Action = {
  id: string;
  name: string;
  description?: string;
  fields?: Record<string, unknown>;
};

export type Call = { entities?: string[]; data?: Record<string, unknown> };

/** Export `homeProvider` from a plugin. Connections and mutable state belong to the app. */
export type Provider = {
  name: string;
  entities(app: App): Promise<Entity[]>;
  actions(app: App): Promise<Action[]>;
  call(app: App, action: string, input: Call): Promise<unknown>;
  history?(app: App, entity: string, period: { start: string; end: string }): Promise<Entity[]>;
};

const registered = (app: App): Provider[] =>
  app.modules.linked().flatMap((mod) => mod.plugin.homeProvider ? [mod.plugin.homeProvider as Provider] : []);

function selected(app: App, name?: string): Provider[] {
  const all = registered(app), names = all.map((p) => p.name);
  if (new Set(names).size !== names.length) throw new Error("home: duplicate provider names");
  if (name === undefined) return all;
  const provider = all.find((p) => p.name === name);
  if (!provider) throw new NotFoundError(`Home provider is not linked: ${name}`);
  return [provider];
}

export const providers = (app: App): string[] => selected(app).map((p) => p.name);

export async function entities(app: App, provider?: string) {
  return (await Promise.all(selected(app, provider).map(async (p) =>
    (await p.entities(app)).map((entity) => ({ ...entity, provider: p.name }))))).flat();
}

export async function actions(app: App, provider?: string) {
  return (await Promise.all(selected(app, provider).map(async (p) =>
    (await p.actions(app)).map((action) => ({ ...action, provider: p.name }))))).flat();
}

/** Dispatch once. A failed or interrupted action is never automatically replayed. */
export function call(app: App, provider: string, action: string, input: Call = {}): Promise<unknown> {
  return selected(app, provider)[0].call(app, action, input);
}

/** Publish an observation, including creation (`previous: null`) or removal (`entity: null`). */
export async function changed(app: App, provider: string, id: string, entity: Entity | null, previous: Entity | null): Promise<void> {
  await app.fire("home:change", { provider, id, entity, previous });
}
