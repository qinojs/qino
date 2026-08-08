// Public API of messaging.sms. The qino plugin lives in ./plugin.ts.

import { $item, ApiError, randB64, safeEqual, sha256b64url, sql, unixTime, type App, type Row } from "../core/mod.ts";
import { deliver, setProvider, type SmsProvider } from "./lib/provider.ts";

export { setProvider, type SmsProvider };

const CODE_TTL = 10 * 60;
const RESEND_AFTER = 60;
const MAX_ATTEMPTS = 5;

/** Deliver text to verified phones of a group, user, one phone, or everyone. */
export async function send(
  app: App,
  to: { grp?: number; usr?: number; phone?: number; all?: true },
  text: string,
): Promise<number> {
  const where = to.grp != null ? sql`AND p.usr_id IN (SELECT usr_id FROM usr_grp WHERE grp_id = ${to.grp})`
    : to.usr != null ? sql`AND p.usr_id = ${to.usr}`
    : to.phone != null ? sql`AND p.id = ${to.phone}`
    : to.all ? sql``
    : null;
  if (!where) throw new Error("send needs a recipient: { grp }, { usr }, { phone } or { all: true }");

  const preferred = to.phone != null ? sql`` : sql`AND (p.main = ${true} OR NOT EXISTS (
    SELECT 1 FROM usr_phone other
    WHERE other.usr_id = p.usr_id AND other.verified IS NOT NULL AND other.id <> p.id
  ))`;
  const rows = await app.db.query`
    SELECT p.id, p.number, p.error FROM usr_phone p
    WHERE p.verified IS NOT NULL ${where} ${preferred}`;
  const table = app.db.table("usr_phone");
  let sent = 0;
  for (const row of rows) {
    try {
      await deliver(app, String(row.number), text);
      sent++;
      if (row.error) await table.update(row.id, { error: null });
    } catch (e) {
      const message = errorMessage(e);
      console.warn(`sms: phone ${row.id} rejected —`, message);
      await table.update(row.id, { error: message.slice(0, 255) });
    }
  }
  return sent;
}

/** Add a phone and send its six-digit verification code. */
export async function addPhone(app: App, usrId: number, input: string): Promise<Row> {
  const number = phoneNumber(input);
  const db = app.db;
  const known = await db.row`SELECT * FROM usr_phone WHERE number = ${number}`;
  const now = unixTime();
  const table = db.table("usr_phone");
  if (known && Number(known.usr_id) !== usrId) {
    if (known.verified || Number(known.verify_expires) >= now) throw new ApiError(409, "Phone number is unavailable");
    await table.update(known.id, { usr_id: usrId, created: now, main: false });
    known.usr_id = usrId;
  }
  if (known?.verified) return publicPhone(known);
  if (known?.verify_sent && Number(known.verify_sent) > now - RESEND_AFTER) {
    throw new ApiError(429, "Wait before requesting another verification code");
  }

  const code = verificationCode();
  const values = {
    verify_hash: await codeHash(app, number, code),
    verify_expires: now + CODE_TTL,
    verify_attempts: 0,
    verify_sent: now,
    error: null,
  };
  const id = known?.id
    ? (await table.update(known.id, values), Number(known.id))
    : Number(await table.insert({ usr_id: usrId, number, created: now, ...values }));

  try {
    await deliver(app, number, await app.t`Your verification code is ${code}.`);
  } catch (e) {
    await table.update(id, { error: errorMessage(e).slice(0, 255) });
    throw e;
  }
  return publicPhone((await db.row`SELECT * FROM usr_phone WHERE id = ${id}`)!);
}

/** Verify one of the user's pending phones. */
export async function verifyPhone(app: App, usrId: number, id: number, code: string): Promise<Row> {
  const row = await app.db.row`SELECT * FROM usr_phone WHERE id = ${id} AND usr_id = ${usrId}`;
  if (!row) throw new ApiError(404, "Phone number not found");
  if (row.verified) return publicPhone(row);

  const now = unixTime();
  const table = app.db.table("usr_phone");
  if (!row.verify_hash || Number(row.verify_expires) < now) {
    await table.update(id, { verify_hash: null, verify_expires: null });
    throw new ApiError(410, "Verification code expired");
  }

  const attempts = Number(row.verify_attempts ?? 0) + 1;
  const valid = /^\d{6}$/.test(code) && safeEqual(await codeHash(app, String(row.number), code), String(row.verify_hash));
  if (!valid) {
    await table.update(id, attempts >= MAX_ATTEMPTS
      ? { verify_attempts: attempts, verify_hash: null, verify_expires: null }
      : { verify_attempts: attempts });
    throw new ApiError(422, attempts >= MAX_ATTEMPTS ? "Verification code rejected; request a new one" : "Verification code is invalid");
  }

  await app.db.transaction(async () => {
    const main = Boolean(await app.db.one`
      SELECT id FROM usr_phone WHERE usr_id = ${usrId} AND verified IS NOT NULL AND main = ${true}`);
    await table.update(id, {
      verified: now,
      main: !main,
      verify_hash: null,
      verify_expires: null,
      verify_attempts: 0,
      error: null,
    });
  });
  return publicPhone((await app.db.row`SELECT * FROM usr_phone WHERE id = ${id}`)!);
}

/** The user's phones without private verification state. */
export async function userPhones(app: App, usrId: number): Promise<Row[]> {
  const rows = await app.db.query`
    SELECT id, number, created, verified, main, verify_sent
    FROM usr_phone WHERE usr_id = ${usrId} ORDER BY created`;
  return rows;
}

/** Forget one phone owned by the user. */
export async function removePhone(app: App, usrId: number, id: number): Promise<void> {
  await app.db.transaction(async () => {
    const row = await app.db.row`SELECT main FROM usr_phone WHERE id = ${id} AND usr_id = ${usrId}`;
    if (!row) return;
    await app.db.exec`DELETE FROM usr_phone WHERE id = ${id} AND usr_id = ${usrId}`;
    if (row.main) {
      const next = await app.db.one`
        SELECT id FROM usr_phone WHERE usr_id = ${usrId} AND verified IS NOT NULL ORDER BY created LIMIT 1`;
      if (next) await app.db.table("usr_phone").update(next, { main: true });
    }
  });
}

/** Make a verified phone the user's preferred SMS destination. */
export async function setMainPhone(app: App, usrId: number, id: number): Promise<Row> {
  const db = app.db;
  await db.transaction(async () => {
    const row = await db.row`SELECT id FROM usr_phone WHERE id = ${id} AND usr_id = ${usrId} AND verified IS NOT NULL`;
    if (!row) throw new ApiError(404, "Verified phone number not found");
    await db.exec`UPDATE usr_phone SET main = ${false} WHERE usr_id = ${usrId}`;
    await db.table("usr_phone").update(id, { main: true });
  });
  return publicPhone((await db.row`SELECT * FROM usr_phone WHERE id = ${id}`)!);
}

/** Verify a pending phone without a code; intended for trusted administration. */
export async function approvePhone(app: App, id: number): Promise<Row> {
  const db = app.db;
  await db.transaction(async () => {
    const row = await db.row`SELECT * FROM usr_phone WHERE id = ${id}`;
    if (!row) throw new ApiError(404, "Phone number not found");
    const main = Boolean(await db.one`
      SELECT id FROM usr_phone WHERE usr_id = ${row.usr_id} AND verified IS NOT NULL AND main = ${true}`);
    await db.table("usr_phone").update(id, {
      verified: row.verified || unixTime(),
      main: Boolean(row.main) || !main,
      verify_hash: null,
      verify_expires: null,
      verify_attempts: 0,
      error: null,
    });
  });
  return publicPhone((await db.row`SELECT * FROM usr_phone WHERE id = ${id}`)!);
}

/** Every phone with its owner; verification internals stay private. */
export function phones(app: App, limit = 500): Promise<Row[]> {
  return app.db.query`
    SELECT p.id, p.usr_id, p.number, p.created, p.verified, p.main, p.verify_sent, p.error, u.email
    FROM usr_phone p LEFT JOIN usr u ON u.id = p.usr_id
    ORDER BY p.created DESC LIMIT ${limit}`;
}

/** Normalize common formatting and require an international E.164 number. */
export function phoneNumber(input: string): string {
  let number = input.trim().replace(/[\s().-]/g, "");
  if (number.startsWith("00")) number = "+" + number.slice(2);
  if (!/^\+[1-9]\d{7,14}$/.test(number)) throw new ApiError(422, "Use an international phone number such as +41791234567");
  return number;
}

function verificationCode(): string {
  return String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, "0");
}

async function codeHash(app: App, number: string, code: string): Promise<string> {
  return sha256b64url(`${await verificationSecret(app)}\0${number}\0${code}`);
}

async function verificationSecret(app: App): Promise<string> {
  const root = app.settings["messaging.sms"];
  let secret = String(await root._secret ?? "");
  if (secret) return secret;
  await app.settings[$item].sub(["messaging.sms"]).item("_secret").set(secret = randB64(32));
  return secret;
}

function publicPhone(row: Row): Row {
  const { verify_hash: _hash, verify_expires: _expires, verify_attempts: _attempts, error: _error, ...phone } = row;
  return phone;
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
