import { html, sql, unixTime } from "@qino/qino";

import type { Ctx, HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

const labels = {
  alphabet: { title: "Sensorik-Training Alphabet", total: 40 },
  words: { title: "Sensorik-Training Wörter", total: 30 },
  twopoint: { title: "Zwei-Punkte-Diskrimination", total: 40 },
};

export function sensoryCms(type: keyof typeof labels) {
  return { node: { render: (node: Node, data: { ctx: Ctx }) => render(node, data.ctx, type), js: ["/m/cms.legacy.sensory/pub/main.js"] } };
}

async function render(node: Node, ctx: Ctx, type: keyof typeof labels): Promise<HtmlString> {
  const body = ctx.req.body;
  let saved = false;
  if (body?.sensory_node === String(node.id) && body.csrfToken === ctx.csrfToken && ctx.userId) {
    const value = Math.max(0, Math.min(100, Number(body.value) || 0));
    const count = type === "twopoint" ? Math.max(0, Math.min(100, Number(body.count) || 0)) : 0;
    const distance = type === "twopoint" ? Math.max(0, Math.min(1000, Number(String(body.distance).replace(/[^0-9.]/g, ""))) || 0) : 0;
    await node.db.query`INSERT INTO ${sql.id("two_point_discrimination")}
      (usr_id, time, value, punkte_anzahl, punkte_distanz, type, pid)
      VALUES (${ctx.userId}, ${unixTime()}, ${value}, ${count}, ${distance}, ${type}, ${node.id})`;
    saved = true;
  }
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const done = ctx.userId && Number(await node.db.one`SELECT COUNT(*) FROM ${sql.id("two_point_discrimination")}
    WHERE pid = ${node.id} AND usr_id = ${ctx.userId} AND time >= ${Math.floor(+today / 1000)} AND type = ${type}`) > (type === "twopoint" ? 2 : 0);
  if (done || saved) return html`<div><h2>${type === "twopoint" ? "Bravo! Das Training für heute ist abgeschlossen." : `Sie haben das ${labels[type].title} für heute erfüllt.`}</h2></div>`;

  const count = type === "twopoint" ? html`<label>Anzahl Punkte <select name=count><option>16<option>18<option>20</select></label>` : "";
  const distance = type === "twopoint" ? html`<label>Abstände <select name=distance>${[90, 85, 80, 75, 70, 65, 60, 55, 50, 45, 40, 35, 30, 25].map((n) => html`<option>${n} mm`)}</select></label>` : "";
  return html`<div data-sensory="${type}" data-total="${labels[type].total}"><form method=post>
  <input type=hidden name=csrfToken value="${ctx.csrfToken}"><input type=hidden name=sensory_node value="${node.id}"><input type=hidden name=value>
  <div class=-setup><h2>${labels[type].title}</h2>${count}${distance}<button type=button class=-start>los</button></div>
  <div class=-round hidden style="text-align:center;font-size:30px"><span class=-prompt></span><br><button type=button class=-wrong>falsch</button> <button type=button class=-right>richtig</button></div>
</form></div>`;
}
