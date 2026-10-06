import { Access, s } from "@qino/qino";

import { apply, removeVirtual, saveVirtual, templates, virtual, virtuals } from "./mod.ts";

import type { ApiTree, Ctx, Params } from "@qino/qino";
import type { Virtual } from "./mod.ts";

// Like home's own routes: virtual entities reach into the house.
const access = Access.SUPERUSER;
const fields = {
  name: s.string(),
  source_provider: s.optional(s.number()).describe("Provider of the source entity; 0 for an entity that is only set"),
  source_entity: s.optional(s.string()).describe("Provider-local source entity ID"),
  command: s.optional(s.number()).describe("Stored home command that sets the entity; 0 for read only"),
  value: s.optional(s.record(s.any())).describe("JSON schema of the value the entity is set to"),
};

export const api: ApiTree = {
  virtuals: {
    get: {
      access, description: "List virtual home entities", query: s.object({ provider: s.optional(s.number()) }),
      execute: ({ provider }: Params, ctx: Ctx) => virtuals(ctx.app, provider as number | undefined),
    },
    post: {
      access, description: "Create a virtual home entity: read from a source entity, set through a command",
      input: s.object({ provider: s.number(), ...fields }),
      execute: async (input: Params, ctx: Ctx) => ({ id: await saveVirtual(ctx.app, input as Partial<Virtual>) }),
    },
  },
  virtual: { ":virtual": {
    paramSchema: s.number(),
    get: {
      access, description: "Read one virtual home entity",
      execute: ({ virtual: id }: Params, ctx: Ctx) => virtual(ctx.app, Number(id)),
    },
    put: {
      access, description: "Edit one virtual home entity", input: s.object({ ...fields, name: s.optional(s.string()) }),
      execute: async ({ virtual: id, ...input }: Params, ctx: Ctx) =>
        ({ id: await saveVirtual(ctx.app, { ...input, id: Number(id) } as Partial<Virtual>) }),
    },
    delete: {
      access, description: "Delete one virtual home entity",
      execute: async ({ virtual: id }: Params, ctx: Ctx) => {
        await removeVirtual(ctx.app, Number(id));
        return { ok: true };
      },
    },
  } },
  templates: { get: {
    access, description: "List templates of virtual entities for kinds of devices",
    execute: () => Object.entries(templates)
      .map(([name, { title, adapter, description }]) => ({ name, title, adapter, description })),
  } },
  template: { ":template": {
    paramSchema: s.string(),
    apply: { post: {
      access, description: "Create a template's commands and virtual entities for one device",
      input: s.object({
        provider: s.number().describe("Virtual provider receiving the entities"),
        source: s.number().describe("Provider of the template's adapter"),
        device: s.string().describe("Device name, e.g. handy for notify.mobile_app_handy"),
      }),
      execute: async ({ template, provider, source, device }: Params, ctx: Ctx) => {
        const target = { provider, source, device } as Parameters<typeof apply>[2];
        return { ids: await apply(ctx.app, String(template), target) };
      },
    } },
  } },
};
