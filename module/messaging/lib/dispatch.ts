import { contactError, fs, sql } from "@qino/qino";

import { delivered } from "./outbox.ts";
import { renderer } from "./template.ts";
import { unsubscribeGroup } from "./unsubscribe.ts";

import type { App, Row } from "@qino/qino";
import type { Attachment, Channel, Msg } from "../mod.ts";

/** What a channel needs to send a recorded delivery. `uses`: placeholders the message uses,
 *  `group`: the group the recipient may leave — both only used by mail. */
export type Rendering = {
  render(row: Row): Promise<{ text: string; html?: string }>;
  uses: Set<string>;
  group(row: Row): number | undefined;
};

/** The deliveries, with placeholder data and their message. */
const load = (app: App, batch: number[]) =>
  app.db.query`
    SELECT d.*, m.grp_id, m.title, m.text, m.format, m.template, m.data,
      u.given_name, u.family_name, u.organization, u.username
    FROM message_delivery d
    JOIN message m ON m.id = d.message_id
    LEFT JOIN usr u ON u.id = d.usr_id
    WHERE ${sql.in("d.id", batch)}`;

/** The message's attachments as files. */
async function attachments(app: App, messageId: number): Promise<Attachment[] | undefined> {
  const files = await app.db.col`SELECT file_id FROM message_attachment WHERE message_id = ${messageId} ORDER BY sort, file_id`;
  if (!files.length) return;
  return Promise.all(files.map(async (id) => {
    const file = await app.dbFiles.file(Number(id));
    const vs = await file.ensureVs();
    return { name: String(vs.name ?? id), type: String(vs.mime ?? ""), content: fs.bytes(file.path) };
  }));
}

/** The recorded message: columns plus channel-specific fields. */
const messageOf = async (app: App, row: Row): Promise<Msg> => ({
  ...JSON.parse(String(row.data ?? "null"))?.msg,
  text: String(row.text ?? ""),
  title: row.title == null ? undefined : String(row.title),
  format: row.format as Msg["format"],
  template: row.template as Msg["template"],
  attachments: await attachments(app, Number(row.message_id)),
});

/**
 * Send recorded deliveries — the only send path, used by `send()` and the outbox. Rendered per
 * recipient and not stored, so a delayed message is rendered at send time.
 */
export async function dispatch(app: App, channel: Channel, batch: number[], msg?: Msg, onError?: (message: string) => void): Promise<number> {
  if (!batch.length) return 0;
  // undeliverable addresses are already finished and skipped
  const rows = (await load(app, batch)).filter((row) => row.sent == null);
  if (!rows.length) return void await bookkeeping(app, channel, batch, onError), 0;
  msg ??= await messageOf(app, rows[0]);
  const usrOf = (row: Row) => Number(row.usr_id) || undefined;
  const [{ render, uses }, leavable] = await Promise.all([
    renderer(app, msg, channel.name, channel.profile),
    unsubscribeGroup(app, Number(rows[0].grp_id) || undefined, rows.map(usrOf)),
  ]);
  const group = (row: Row) => leavable(usrOf(row));
  const attempts = new Map(rows.map((row) => [Number(row.id), Number(row.attempts)]));
  try {
    return await channel.deliver(app, rows, msg, {
      uses,
      group,
      render: (row) => render({ ...row, usrId: usrOf(row), deliveryId: Number(row.id), grpId: group(row) }),
    });
  } catch (e) {
    // the whole batch failed; mark the rest as failed too
    for (const row of await app.db.query`SELECT id, attempts FROM message_delivery WHERE sent IS NULL AND ${sql.in("id", batch)}`) {
      if (attempts.get(Number(row.id)) === Number(row.attempts)) await delivered(app, Number(row.id), e);
    }
    throw e;
  } finally {
    await bookkeeping(app, channel, batch, onError);
  }
}

/**
 * Store the outcomes. All failures are reported, but only real delivery failures mark the contact;
 * our own failures leave it due and don't touch the contact's mark.
 */
async function bookkeeping(app: App, channel: Channel, batch: number[], onError?: (message: string) => void): Promise<void> {
  if (!onError && !channel.contact) return;
  const rows = await app.db.query`SELECT usr_id, address, error, sent FROM message_delivery WHERE ${sql.in("id", batch)}`;
  for (const row of rows) {
    if (row.error) onError?.(String(row.error));
    if (channel.contact && row.usr_id && row.sent != null) {
      await contactError(app.db, channel.contact, String(row.address), row.error ? String(row.error) : undefined);
    }
  }
}
