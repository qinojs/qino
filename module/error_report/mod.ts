/**
 * error_report/mod.ts
 * Port of error_report/qg.php
 *
 * reporter.js läuft auf zwei Seiten:
 *  - Deno-Backend:  importiert, send() → direkt in DB schreiben
 *  - Browser:       mod.js serviert, reporterJsOptions.url → /js-error Endpoint → DB
 */
// deno-lint-ignore-file no-explicit-any

import dbSchema from "./dbschema.json" with { type: "json" };
import type { App } from "../core/server.ts";
import type { Context } from "../../deps.ts";
import { getCtx } from "../core/lib/RequestContext.ts";
import type { RequestContext } from "../core/lib/RequestContext.ts";

const reporterPath = "https://cdn.jsdelivr.net/gh/nuxodin/reporter.js@1.2.0/mod.js";
await import(reporterPath);

export const name = "error_report";
export const needs = ["core"];
export { dbSchema };

export const settingsSchema = {
  properties: {
    browserErrors: {
      type: "boolean",
      description: "Schaltet clientseitiges Fehlerreporting ein oder aus.",
    },
  },
};

export function routes(app: App): void {
  app.router.all("/js-error", (c) => handleJsError(c));
  app.router.all("/css-error", (c) => handleCssError(c));
  app.router.all("/csp-error", (c) => handleCspError(c));
}

async function handleJsError(c: Context): Promise<Response> {
  const ctx = c.get("ctx") as RequestContext;
  const report = ctx.post as Record<string, any>;
  if (report.message) {
    report.source ??= "js";
    await addReport(ctx.app, report);
  }
  return c.json({});
}

async function handleCssError(c: Context): Promise<Response> {
  const ctx = c.get("ctx") as RequestContext;
  const file = ctx.server.HTTP_REFERER;
  const message = ctx.get.message || "css-error";
  const report: Record<string, any> = { source: "css", message, file, backtrace: [] };
  if (file) {
    try {
      const content = await Deno.readTextFile(file);
      const before = content.split(message)[0];
      if (before !== undefined) {
        const lines = before.split("\n");
        report.line = lines.length;
        report.col = lines[lines.length - 1].length;
      }
    } catch { /* Datei nicht lokal zugänglich */ }
  }
  await addReport(ctx.app, report);
  return new Response("", { status: 500 });
}

async function handleCspError(c: Context): Promise<Response> {
  const ctx = c.get("ctx") as RequestContext;
  const cspReport = ctx.post["csp-report"] as Record<string, any> | undefined;
  if (cspReport) {
    const directive = cspReport["effective-directive"] ?? cspReport["violated-directive"] ?? "";
    let blockedUri = cspReport["blocked-uri"] ?? "";
    if (/^https?:/.test(blockedUri)) blockedUri = new URL(blockedUri).origin;
    const reportOnly = !!ctx.responseHeaders.get("Content-Security-Policy-Report-Only");
    await addReport(ctx.app, {
      message: (reportOnly ? "Report only: " : "Blocked: ") + `"${blockedUri}" blocked by "${directive}"`,
      source: "csp",
      file: cspReport["source-file"] ?? "",
      line: cspReport["line-number"] ?? "",
      request: cspReport["document-uri"] ?? "",
      referer: cspReport["referrer"] ?? "",
      backtrace: [],
      sample: cspReport["script-sample"] ?? null,
      prio: reportOnly ? "notice" : "warning",
    });
  }
  return c.json({});
}

async function addReport(app: any, vs: Record<string, any>): Promise<void> {
  vs.file ??= "";
  vs.line ??= "";
  vs.col ??= "";
  vs.backtrace ??= [];
  vs.source ??= "js";
  vs.time ??= new Date().toISOString().slice(0, 19).replace("T", " ");
  try {
    const ctx = getCtx();
    vs.request ??= ctx.appURL + ctx.appRequestUri;
    vs.referer ??= ctx.server.HTTP_REFERER;
    vs.browser ??= ctx.server.HTTP_USER_AGENT;
    vs.ip ??= ctx.server.REMOTE_ADDR;
    vs.log_id ??= ctx.logId ?? null;
  } catch { /* kein Request-Context vorhanden */ }
  const row = { ...vs };
  if (Array.isArray(row.backtrace)) row.backtrace = JSON.stringify(row.backtrace);
  await app.db.table("m_error_report").insert(row).catch(() => {});
}

export function init(app: App): void {
  // ── Config ───────────────────────────────────────────────────────────

  (globalThis as any).reporterJsOptions = {
    onError: async (data: Record<string, any>) => {
      data.source ??= "deno";
      await addReport(app, data);
    },
  };

  // ── Browser-Frontend: reporter.js + Konfiguration ins HTML injizieren ───────

  app.on("render", async ({ ctx }: any) => {
    if (!ctx.hasHtml) return;
    const browserErrorsEnabled = await ctx.app.settings.error_report.browserErrors;
    if (!browserErrorsEnabled) return;
    ctx.html.head += `<script>window.reporterJsOptions={url:${JSON.stringify(ctx.appURL + "js-error")},max:50};</script>\n`;
    ctx.html.addJSFile(reporterPath);
    ctx.cspReportUri = ctx.appURL + "csp-error";
  });
}

