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
import { urlToLocalPath, assertAllowedPath } from "../core/lib/util.ts";
import type { RequestContext } from "../core/lib/RequestContext.ts";

const reporterPath = "https://cdn.jsdelivr.net/gh/nuxodin/reporter.js@1.2.0/mod.js";
await import(reporterPath);

type Report = Record<string, any>;

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
  app.router.all("/js-error", handleJsError);
  app.router.all("/css-error", handleCssError);
  app.router.all("/csp-error", handleCspError);
}

async function handleJsError(c: Context): Promise<Response> {
  const ctx = c.get("ctx") as RequestContext;
  const report = ctx.post as Report;
  if (report.message) {
    await addReport(ctx.app, { source: "js", ...report });
  }
  return c.json({});
}

async function handleCssError(c: Context): Promise<Response> {
  const ctx = c.get("ctx") as RequestContext;
  const file = ctx.server.HTTP_REFERER;
  const message = ctx.get.message || "css-error";
  const report: Report = { source: "css", message, file, backtrace: [] };
  if (file) {
    try {
      const localPath = urlToLocalPath(file, ctx);
      if (!localPath) throw new Error("not a local file");
      if (!localPath.endsWith(".css")) throw new Error("not a css file");
      assertAllowedPath(localPath, ctx.app);
      const content = await Deno.readTextFile(localPath);
      const pos = content.indexOf(message);
      if (pos >= 0) {
        const before = content.slice(0, pos);
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
  const report = ctx.post["csp-report"] as Report;
  if (report) {
    const directive = report["effective-directive"] ?? report["violated-directive"] ?? "";
    let blockedUri = report["blocked-uri"] ?? "";
    if (typeof blockedUri === "string" && /^https?:/.test(blockedUri)) {
      try { blockedUri = new URL(blockedUri).origin; } catch { /* ungültige Browser-URL behalten */ }
    }
    const reportOnly = report.disposition === "report";
    await addReport(ctx.app, {
      message: (reportOnly ? "Report only: " : "Blocked: ") + `"${blockedUri}" blocked by "${directive}"`,
      source: "csp",
      file: report["source-file"] ?? "",
      line: report["line-number"] ?? "",
      request: report["document-uri"] ?? "",
      referer: report["referrer"] ?? "",
      backtrace: [],
      sample: report["script-sample"] ?? null,
      prio: reportOnly ? "notice" : "warning",
    });
  }
  return c.json({});
}

async function addReport(app: any, vs: Report): Promise<void> {
  const row: Report = {
    file: "",
    line: "",
    col: "",
    backtrace: [],
    source: "js",
    time: new Date().toISOString().slice(0, 19).replace("T", " "),
    ...vs,
  };
  try {
    const ctx = getCtx();
    row.request ??= ctx.appURL + ctx.appRequestUri;
    row.referer ??= ctx.server.HTTP_REFERER;
    row.browser ??= ctx.server.HTTP_USER_AGENT;
    row.ip ??= ctx.server.REMOTE_ADDR;
    row.log_id ??= ctx.logId ?? null;
  } catch { /* kein Request-Context vorhanden */ }
  if (Array.isArray(row.backtrace)) row.backtrace = JSON.stringify(row.backtrace);
  await app.db.table("m_error_report").insert(row).catch(() => {});
}

export function init(app: App): void {

  (globalThis as any).reporterJsOptions = {
    onError: async (data: Report) => {
      data.source ??= "deno";
      await addReport(app, data);
    },
  };

  app.on("render", async ({ ctx }: any) => {
    if (!ctx.hasHtml) return;
    const browserErrorsEnabled = await ctx.app.settings.error_report.browserErrors;
    if (!browserErrorsEnabled) return;
    ctx.html.head += `<script>window.reporterJsOptions={url:${JSON.stringify(ctx.appURL + "js-error")},max:50};</script>\n`;
    ctx.html.addJSFile(reporterPath);
    ctx.cspReportUri = ctx.appURL + "csp-error";
  });
}
