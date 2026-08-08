// Public API of messaging. The qino plugin lives in ./plugin.ts.

import { unixTime, type App, type Row } from "../core/mod.ts";

/** Store one logical message and one result per recipient. */
export async function record(
  app: App,
  message: { channel: string; direction: "in" | "out"; data?: unknown; grpId?: number; logId?: number; time?: number },
  deliveries: { usrId?: number; error?: string; time?: number }[] = [],
): Promise<number> {
  if (!message.channel) throw new Error("message channel is required");
  const time = message.time ?? unixTime();
  let id = 0;
  await app.db.transaction(async () => {
    id = Number(await app.db.table("message").insert({
      channel: message.channel,
      direction: message.direction,
      grp_id: message.grpId ?? null,
      log_id: message.logId ?? null,
      data: JSON.stringify(message.data ?? null),
      time,
    }));
    const table = app.db.table("message_delivery");
    for (const delivery of deliveries) {
      await table.insert({
        message_id: id,
        usr_id: delivery.usrId ?? null,
        time: delivery.time ?? unixTime(),
        error: delivery.error ?? null,
      });
    }
  });
  return id;
}

/** Recent logical messages including their recipient detail rows. */
export async function messages(app: App, limit = 100): Promise<(Row & { deliveries: Row[] })[]> {
  const rows = await app.db.query`
    SELECT m.id, m.channel, m.direction, m.grp_id, m.log_id, m.data, m.time,
      g.name AS grp_name, d.id AS delivery_id, d.usr_id, d.time AS delivery_time,
      d.error, u.email
    FROM (SELECT * FROM message ORDER BY time DESC, id DESC LIMIT ${limit}) m
    LEFT JOIN grp g ON g.id = m.grp_id
    LEFT JOIN message_delivery d ON d.message_id = m.id
    LEFT JOIN usr u ON u.id = d.usr_id
    ORDER BY m.time DESC, m.id DESC, d.id`;
  const byId = new Map<number, Row & { deliveries: Row[] }>();
  for (const row of rows) {
    const id = Number(row.id);
    const message = byId.getOrInsertComputed(id, () => ({
      id: row.id,
      channel: row.channel,
      direction: row.direction,
      grp_id: row.grp_id,
      grp_name: row.grp_name,
      log_id: row.log_id,
      data: row.data,
      time: row.time,
      deliveries: [],
    }));
    if (row.delivery_id != null) message.deliveries.push({
      id: row.delivery_id,
      usr_id: row.usr_id,
      email: row.email,
      time: row.delivery_time,
      error: row.error,
    });
  }
  return [...byId.values()];
}
