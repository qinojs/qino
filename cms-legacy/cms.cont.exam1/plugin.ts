import { html, sql, unixTime, type Ctx, type HtmlString } from "../../module/core/mod.ts";
import type { Node } from "../../module/cms/mod.ts";

export const name = "cms.cont.exam1";
export const description = "Legacy study examination with persisted per-user answers.";
export const needs = ["cms"];

async function render(node: Node, { ctx }: { ctx: Ctx }): Promise<HtmlString> {
  const ids = String(await node.settings.ids ?? "").split(",").map(Number).filter((id) => id > 0);
  let exam: Record<string, unknown> | undefined;
  for (const id of ids) {
    if (ctx.userId && await node.db.one`SELECT completed FROM ${sql.id("exam1_usr")} WHERE exam_id = ${id} AND usr_id = ${ctx.userId}`) continue;
    exam = await node.db.row`SELECT * FROM ${sql.id("exam1")} WHERE id = ${id}`;
    if (exam) break;
  }
  if (!exam) return html`<div><h2>Sie sind mit allen Prüfungen durch</h2></div>`;
  const tasks = await node.db.query`SELECT * FROM ${sql.id("exam1_task")} WHERE exam_id = ${exam.id} ORDER BY sort, id`;

  if (ctx.userId && ctx.req.body?.exam_node === String(node.id) && ctx.req.body.csrfToken === ctx.csrfToken) {
    let result = 0;
    for (const task of tasks) {
      const value = String(ctx.req.body[`task_${task.id}`] ?? "").trim();
      const points = value === String(task.answer).trim() ? Number(task.points) || 0 : 0;
      const exists = await node.db.one`SELECT 1 FROM ${sql.id("exam1_task_usr")} WHERE task_id = ${task.id} AND usr_id = ${ctx.userId}`;
      if (exists) await node.db.query`UPDATE ${sql.id("exam1_task_usr")} SET time = ${unixTime()}, value = ${value}, points = ${points} WHERE task_id = ${task.id} AND usr_id = ${ctx.userId}`;
      else await node.db.query`INSERT INTO ${sql.id("exam1_task_usr")} (task_id, usr_id, time, value, points) VALUES (${task.id}, ${ctx.userId}, ${unixTime()}, ${value}, ${points})`;
      result += points;
    }
    const exists = await node.db.one`SELECT 1 FROM ${sql.id("exam1_usr")} WHERE exam_id = ${exam.id} AND usr_id = ${ctx.userId}`;
    if (exists) await node.db.query`UPDATE ${sql.id("exam1_usr")} SET completed = ${unixTime()}, result = ${result} WHERE exam_id = ${exam.id} AND usr_id = ${ctx.userId}`;
    else await node.db.query`INSERT INTO ${sql.id("exam1_usr")} (exam_id, usr_id, completed, result) VALUES (${exam.id}, ${ctx.userId}, ${unixTime()}, ${result})`;
    return html`<div><h2>${String(exam.completion_text || "Prüfung abgeschlossen")}</h2></div>`;
  }

  const fields: HtmlString[] = [];
  for (const task of tasks) {
    const options = String(task.options ?? "").split(";").map((value) => value.trim()).filter(Boolean);
    let input: HtmlString;
    if (String(task.type) === "bool") input = html`<label><input required type=radio name="task_${task.id}" value=1> Ja</label> <label><input required type=radio name="task_${task.id}" value=0> Nein</label>`;
    else if (options.length) input = html`<span>${html.join(options.map((value) => html`<label><input required type=radio name="task_${task.id}" value="${value}"> ${value}</label><br>`))}</span>`;
    else input = html`<input required name="task_${task.id}">`;
    fields.push(html`<div class=-task><h2 class=-question>${String(task.question)}</h2><div class=-answer>${input}</div></div>`);
  }
  return html`<div><form method=post><input type=hidden name=csrfToken value="${ctx.csrfToken}"><input type=hidden name=exam_node value="${node.id}">
  <h1>${String(exam.title)}</h1><div class=-contents>${await (await node.cont(String(exam.id))).html()}</div>${html.join(fields)}
  <br>${await node.showText("text_" + exam.id)}<br><button>Tag abschliessen!</button></form></div>`;
}

export const cms = { node: { render } };
