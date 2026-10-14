import { errMsg } from "@qino/qino";
import { backend } from "@qino/qino/cms.backend";
import { save } from "@qino/qino/home";
import { apply, removeVirtual, saveVirtual } from "@qino/qino/home.virtual";

import { list, render } from "./render.ts";
import manifest from "./manifest.json" with { type: "json" };

import type { App } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

const { name } = manifest;

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, name, { en: "Virtual entities", de: "Virtuelle Entitäten" });
}

export async function uninstall({ app }: { app: App }): Promise<void> {
  await backend.uninstall(app, name);
}

type Vars = Record<string, unknown>;

async function api(node: Node, vars: Vars): Promise<unknown> {
  const app = node.app, t = app.t;
  try {
    if (vars.provider === "new") {
      await save(app, { name: "Virtual", adapter: "virtual" });
      return { ok: true, message: await t`Provider saved.` };
    }
    if (vars.apply !== undefined) {
      const { template, provider, source, device } = vars.apply as Vars;
      const ids = await apply(app, String(template), {
        provider: Number(provider), source: Number(source), device: String(device),
      });
      return { ok: true, message: `${ids.length} ${await t`virtual entities created.`}` };
    }
    if (vars.virtual !== undefined) {
      await saveVirtual(app, vars.virtual as Parameters<typeof saveVirtual>[1]);
      return { ok: true, message: await t`Virtual entity saved.` };
    }
    if (vars.remove !== undefined) {
      await removeVirtual(app, Number(vars.remove));
      return { ok: true, message: await t`Virtual entity deleted.` };
    }
    return false;
  } catch (error) { return { ok: false, message: errMsg(error) }; }
}

export const cms = {
  node: { render, api, js: ["pub/main.js"], parts: { list } },
};
