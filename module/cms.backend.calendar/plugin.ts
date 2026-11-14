import { ApiError, getCtx, html, moduleIcon } from "@qino/qino";
import { entries, sources } from "@qino/qino/calendar";
import { backend } from "@qino/qino/cms.backend";
import * as u2 from "@qino/qino/u2";

import manifest from "./manifest.json" with { type: "json" };

import type { App, Ctx } from "@qino/qino";
import type { Node } from "@qino/qino/cms";
import type { Period } from "@qino/qino/calendar";

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, manifest.name, { en: "Calendar", de: "Kalender" });
}

export async function uninstall({ app }: { app: App }): Promise<void> {
  await backend.uninstall(app, manifest.name);
}

export const ctxSettingsSchema = {
  properties: { sources: { type: "object", additionalProperties: { type: "boolean" }, description: "Visibility by calendar source ID; unset sources are visible." } },
};

function selection(ctx: Ctx, available = sources(ctx.app, ctx.lang)) {
  const saved = ctx.settings[manifest.name].sources() as Record<string, boolean> | undefined;
  return available.filter((source) => saved?.[source.id] !== false).map((source) => source.id);
}

function icons(ctx: Ctx, available: ReturnType<typeof sources>) {
  return available.map((source) => {
    const icon = moduleIcon(ctx.app.modules.linked(source.id));
    return icon ? html`<template data-source-icon="${source.id}"><svg class=-source-icon aria-hidden=true focusable=false>${icon}</svg></template>` : "";
  });
}

export async function backendDashboardWidget(_app: App, page: Node) {
  const ctx = getCtx();
  const node = (await page.conts()).find((cont) => cont.vs.module === manifest.name);
  if (!node) return "";
  ctx.res.html.scripts.add(node.modUrl + "pub/dashboard.js");
  ctx.res.html.styles.add(node.modUrl + "pub/main.css");
  const selected = selection(ctx);
  const available = sources(ctx.app, ctx.lang).filter((source) => selected.includes(source.id));
  return html.async`<div class=cms-calendar-dashboard data-calendar-dashboard="${node.id}" data-sources="${JSON.stringify(available)}">
    ${icons(ctx, available)}
    <p role=status>${ctx.app.t.in(manifest.name)`Loading appointments…`}</p><ol></ol>
  </div>`;
}

async function render(node: Node, { ctx }: { ctx: Ctx }) {
  u2.assets(ctx, ["el/calendar/calendar.css"]);
  const available = sources(ctx.app, ctx.lang);
  const selected = selection(ctx, available);
  const t = node.app.t.in(manifest.name);
  return html.async`<div class="u2-card" style="align-self: stretch; flex:1 1 auto" data-sources="${JSON.stringify(available)}" data-selected="${JSON.stringify(selected)}">
    ${icons(ctx, available)}
    <div class=-head>${t`Calendar`}</div>
    <div>
      <button type=button data-calendar-sources>${t`Sources`}</button>
    </div>
    <u2-calendar lang="${ctx.lang}" style="flex: 1 1 auto; padding:0"></u2-calendar>
    <p role=status></p>
  </div>`;
}

async function api(_node: Node, period: Period & { sources?: string[]; save?: boolean }) {
  const ctx = getCtx();
  if (period.save) {
    if (!Array.isArray(period.sources) || period.sources.some((id) => typeof id !== "string"))
      throw new ApiError(400, "Calendar sources must be an array of source IDs");
    const selected = new Set(period.sources);
    await ctx.settings[manifest.name].sources(Object.fromEntries(sources(ctx.app, ctx.lang).map((source) => [source.id, selected.has(source.id)])));
  }
  return entries(ctx, { ...period, sources: period.sources ?? selection(ctx) });
}

export const cms = { node: { css: ["pub/main.css"], js: ["pub/main.js"], render, api } };
