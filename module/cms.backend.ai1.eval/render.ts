import { html } from "@qino/qino";
import * as u2 from "@qino/qino/u2";

import { BENCHMARKS_KEY } from "./lib/eval.ts";

import type { HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

const value = (v: unknown, digits = 1) => v == null ? "–" : Number(v).toLocaleString("en-US", { maximumFractionDigits: digits });
/** artificial_analysis_coding_index → coding */
const label = (metric: string) => metric.replace(/^artificial_analysis_|^aa_/, "").replace(/_index$/, "").replaceAll("_", " ");
const INTELLIGENCE = "artificial_analysis_intelligence_index";

export function render(node: Node): Promise<HtmlString> {
  const t = node.app.t;
  return html.async`<div class=u2-card>
  <div class=-head>
    <span>${t`AI evaluation`}</span>
    <button type=button data-key>${t`Benchmark key`}</button>
    <button type=button data-evaluate>${t`Evaluate now`}</button>
  </div>
  <div cms-part=list>${list(node)}</div>
  <div class=-body><small>
    ${t`Context, prices and capabilities`}: <a href="https://models.dev" target=_blank rel=noopener>models.dev</a>
    · ${t`Benchmarks`}: <a href="https://artificialanalysis.ai/" target=_blank rel=noopener>Artificial Analysis</a>
    · ${t`Measured: the calls through ai1. Runs daily; speed hourly.`}
  </small></div>
</div>`;
}

/** Per model its context and scores in every area; per provider its price, speed and reliability. */
export async function list(node: Node): Promise<HtmlString> {
  const app = node.app, t = app.t, db = app.db;
  const [models, scores, offers] = await Promise.all([
    db.query`SELECT m.id, m.name, e.context, e.bench_speed, e.bench_ttft FROM ai1_model m LEFT JOIN ai1_eval_model e ON e.model_id = m.id ORDER BY m.name`,
    db.query`SELECT model_id, metric, value FROM ai1_eval_score`,
    db.query`
      SELECT m.name AS model, p.name AS provider, mp.cost, mp.speed, s.calls, s.errors, s.text_ms, s.text_output, s.last_error, s.last_at
      FROM ai1_model_provider mp
      JOIN ai1_model m ON m.id = mp.model_id
      JOIN ai1_provider p ON p.id = mp.provider_id
      LEFT JOIN ai1_eval_stat s ON s.model_provider_id = mp.id
      ORDER BY m.name, p.name`,
  ]);
  const score = (model: number, metric: string) => scores.find((s) => s.model_id === model && s.metric === metric)?.value;
  // the indexes first, then the benchmarks behind them
  const metrics = [...new Set(scores.map((s) => String(s.metric)))].sort((a, b) =>
    Number(b === INTELLIGENCE) - Number(a === INTELLIGENCE) || Number(b.endsWith("_index")) - Number(a.endsWith("_index")) || a.localeCompare(b));
  models.sort((a, b) => (score(b.id, INTELLIGENCE) ?? -1) - (score(a.id, INTELLIGENCE) ?? -1));
  const hasKey = !!await app.settings.core.keys[BENCHMARKS_KEY];

  const modelRows = models.map((m) => html`<tr>
    <th>${m.name}
    <td>${value(m.context, 0)}
    <td>${value(m.bench_speed)}
    <td>${value(m.bench_ttft, 2)}
    ${metrics.map((metric) => html`<td>${value(score(m.id, metric))}`)}`);

  const offerRows = offers.map((o) => html`<tr>
    <th>${o.model}
    <td>${o.provider}
    <td>${value(o.cost, 3)}
    <td>${value(o.speed)}
    <td>${value(o.calls, 0)}
    <td>${o.calls ? `${value(100 * o.errors / o.calls, 0)} %` : "–"}
    <td>${o.text_ms ? value(o.text_output / (o.text_ms / 1000)) : "–"}
    <td>${o.last_error ? html`<details><summary>${u2.el.time(o.last_at)}</summary><div class=-error>${o.last_error}</div></details>` : ""}`);

  return html.async`${hasKey ? "" : html.async`<div class=-body><small>${t`Without an Artificial Analysis key only models.dev and the measured values are used.`}</small></div>`}
<table class="u2-table -Sticky">
  <thead><tr>
    <th>${t`Model`}
    <th class=-v>${t`Context`}
    <th class=-v>${t`Bench t/s`}
    <th class=-v title="${t`Seconds to the first token`}">${t`Bench TTFT`}
    ${metrics.map((metric) => html`<th class=-v title="${metric}">${label(metric)}`)}
  <tbody>${modelRows.length ? modelRows : html.async`<tr><td colspan=${4 + metrics.length}>${t`No models yet.`}`}
</table>
<table class="u2-table -Sticky">
  <thead><tr>
    <th>${t`Model`}
    <th>${t`Provider`}
    <th>${t`Cost`} <small>/M</small>
    <th>${t`Speed`} <small>/s</small>
    <th>${t`Calls`}
    <th>${t`Errors`}
    <th>${t`Measured t/s`}
    <th>${t`Last error`}
  <tbody>${offerRows}
</table>`;
}
