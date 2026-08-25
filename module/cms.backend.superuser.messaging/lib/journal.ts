// The journal as the panel shows it: one row per message, its deliveries and attachments nested,
// with the group and user names the table prints. That shape is this view's business, not messaging's.
import { sql } from "@qino/qino";

import type { App, Row } from "@qino/qino";

export type JournalMessage = Row & { deliveries: Row[]; attachments: Row[] };

/** Recent logical messages including their recipient and attachment detail rows. */
export function messages(app: App, limit = 100): Promise<JournalMessage[]> {
  return read(app, limit);
}

/** Recent messages sent to or received from one user. */
export function userMessages(app: App, usrId: number, limit?: number): Promise<JournalMessage[]> {
  return read(app, limit, usrId);
}

async function read(app: App, limit?: number, usrId?: number): Promise<JournalMessage[]> {
  const where = usrId == null ? sql`` : sql`WHERE EXISTS (
    SELECT 1 FROM message_delivery selected
    WHERE selected.message_id = m.id AND selected.usr_id = ${usrId}
  )`;
  const delivery = usrId == null ? sql`` : sql`AND d.usr_id = ${usrId}`;
  const take = limit == null ? sql`` : sql`LIMIT ${limit}`;
  const rows = await app.db.query`
    SELECT m.id, m.channel, m.direction, m.grp_id, m.log_id, m.title, m.text, m.format, m.template, m.data, m.time,
      (SELECT COUNT(*) FROM message_delivery md WHERE md.message_id = m.id) AS recipient_count,
      g.name AS grp_name, d.id AS delivery_id, d.usr_id, d.address, d.sent AS delivery_sent,
      d.due, d.attempts, d.error, u.username
    FROM (SELECT m.* FROM message m ${where} ORDER BY m.time DESC, m.id DESC ${take}) m
    LEFT JOIN grp g ON g.id = m.grp_id
    LEFT JOIN message_delivery d ON d.message_id = m.id ${delivery}
    LEFT JOIN usr u ON u.id = d.usr_id
    ORDER BY m.time DESC, m.id DESC, d.id`;
  const byId = new Map<number, JournalMessage>();
  for (const row of rows) {
    const id = Number(row.id);
    const message = byId.getOrInsertComputed(id, () => ({
      id: row.id,
      channel: row.channel,
      direction: row.direction,
      grp_id: row.grp_id,
      grp_name: row.grp_name,
      log_id: row.log_id,
      title: row.title,
      text: row.text,
      format: row.format,
      template: row.template,
      data: row.data,
      time: row.time,
      recipient_count: row.recipient_count,
      deliveries: [],
      attachments: [],
    }));
    if (row.delivery_id != null) message.deliveries.push({
      id: row.delivery_id,
      usr_id: row.usr_id,
      address: row.address,
      username: row.username,
      sent: row.delivery_sent,
      due: row.due,
      attempts: row.attempts,
      error: row.error,
    });
  }
  const messages = [...byId.values()];
  if (!messages.length) return messages;
  const ids = sql.join(messages.map((message) => sql`${message.id}`), ", ");
  const links = await app.db.query`
    SELECT a.message_id, a.file_id, a.sort FROM message_attachment a
    WHERE a.message_id IN (${ids})
    ORDER BY a.message_id, a.sort, a.file_id`;
  if (!links.length) return messages;
  const fileIds = sql.join(links.map((link) => sql`${link.file_id}`), ", ");
  const files = new Map((await app.db.query`
    SELECT id, name, mime, size FROM file WHERE id IN (${fileIds})`
  ).map((file) => [Number(file.id), file]));
  for (const link of links) {
    const file = files.get(Number(link.file_id));
    if (!file) continue;
    byId.get(Number(link.message_id))?.attachments.push({ file_id: link.file_id, name: file.name, mime: file.mime, size: file.size, sort: link.sort });
  }
  return messages;
}
