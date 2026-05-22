/**
 * error_report/mod.ts
 * Port of error_report/qg.php
 *
 * reporter.js runs on two sides:
 *  - Deno backend:  imported, send() → write directly to DB
 *  - Browser:       mod.js served, reporterJsOptions.url → /js-error endpoint → DB
 */
// deno-lint-ignore-file no-explicit-any

import dbSchema from "./dbschema.json" with { type: "json" };
import type { App } from "../core/server.ts";
import { getCtx, type RequestContext } from "../core/lib/RequestContext.ts";
import { AnswerError, OutputDoneError, urlToLocalPath, assertAllowedPath } from "../core/lib/util.ts";

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
      description: "Enables or disables client-side error reporting.",
    },
  },
};

async function handleJsError(ctx: RequestContext): Promise<void> {
  const report = ctx.post as Report;
  if (report.message) {
    await addReport(ctx.app, { source: "js", ...report });
  }
  throw new AnswerError({});
}

async function handleCssError(ctx: RequestContext): Promise<void> {
  const file = ctx.req.header("referer");
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
    } catch { /* file not locally accessible */ }
  }
  await addReport(ctx.app, report);
  ctx.responseStatus = 500;
  throw new OutputDoneError();
}

async function handleCspError(ctx: RequestContext): Promise<void> {
  const report = ctx.post["csp-report"] as Report;
  if (report) {
    const directive = report["effective-directive"] ?? report["violated-directive"] ?? "";
    let blockedUri = report["blocked-uri"] ?? "";
    if (typeof blockedUri === "string" && /^https?:/.test(blockedUri)) {
      try { blockedUri = new URL(blockedUri).origin; } catch { /* keep invalid browser URL as-is */ }
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
  throw new AnswerError({});
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
    row.referer ??= ctx.req.header("referer");
    row.browser ??= ctx.req.header("user-agent");
    row.ip ??= ctx.remoteAddr;
    row.log_id ??= ctx.logId ?? null;
  } catch { /* no request context available */ }
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

  app.on("action", ({ ctx }: any) => {
    if (ctx.appRequestUri === "js-error")  return handleJsError(ctx);
    if (ctx.appRequestUri === "css-error") return handleCssError(ctx);
    if (ctx.appRequestUri === "csp-error") return handleCspError(ctx);
  });

  app.on("render", async ({ ctx }: any) => {
    if (!ctx.hasHtml) return;
    const browserErrorsEnabled = await ctx.app.settings.error_report.browserErrors;
    if (!browserErrorsEnabled) return;
    ctx.html.head += `<script>window.reporterJsOptions={url:${JSON.stringify(ctx.appURL + "js-error")},max:50};</script>\n`;
    ctx.html.addJSFile(reporterPath);
    ctx.cspReportUri = ctx.appURL + "csp-error";
  });
}
