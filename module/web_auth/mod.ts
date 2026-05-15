// deno-lint-ignore-file no-explicit-any
import dbSchema from "./dbschema.json" with { type: "json" };
import { getCtx } from "../core/lib/RequestContext.ts";
import { login } from "../core/lib/auth.ts";
import { Access, AccessError } from "../core/lib/apt.ts";
import { s } from "../core/lib/StandardSchema.ts";
import type { App } from "../core/server.ts";
import type { AptTree } from "../core/lib/apt.ts";

export const name = "web_auth";
export { dbSchema };

export const settingsSchema = {
  properties: {
    rpId:   { type: "string", description: "Relying Party ID — Domain ohne Protokoll, z.B. example.com" },
    rpName: { type: "string", description: "Anzeigename der Anwendung im Authenticator-Dialog" },
  },
};

// ─── Encoding ─────────────────────────────────────────────────────────────────

function b64url(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let str = "";
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function b64urlDecode(s: string): Uint8Array {
  const padded = s.replace(/-/g, "+").replace(/_/g, "/").padEnd(s.length + (4 - s.length % 4) % 4, "=");
  const bin = atob(padded);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// ─── Challenge store ───────────────────────────────────────────────────────────

const CHALLENGE_TTL = 5 * 60;
const now = () => Math.floor(Date.now() / 1000);
const randB64 = (n: number) => b64url(crypto.getRandomValues(new Uint8Array(n)));

async function storeChallenge(db: any, challenge: string, usrId: number, type: "register" | "login" | "confirm"): Promise<string> {
  const token = randB64(24);
  await db.table("web_auth_challenge").insert({ token, challenge, usr_id: usrId, type, expires: now() + CHALLENGE_TTL });
  await db.exec("DELETE FROM web_auth_challenge WHERE expires < ?", [now()]);
  return token;
}

async function consumeChallenge(db: any, token: string, type: string): Promise<{ challenge: string; usr_id: number } | null> {
  const row = await db.row(
    "SELECT challenge, usr_id FROM web_auth_challenge WHERE token = ? AND type = ? AND expires > ?",
    [token, type, now()],
  );
  if (!row) return null;
  await db.exec("DELETE FROM web_auth_challenge WHERE token = ?", [token]);
  return { challenge: row.challenge, usr_id: Number(row.usr_id) };
}

// ─── WebAuthn parsing & verification ──────────────────────────────────────────

function parseClientData(b64: string): Record<string, unknown> {
  return JSON.parse(new TextDecoder().decode(b64urlDecode(b64)));
}

function verifyOrigin(clientData: Record<string, unknown>, rpId: string): boolean {
  const origin = String(clientData.origin ?? "");
  return origin.includes(rpId) || rpId.includes("localhost");
}

// Minimal CBOR decoder — covers the subset used by WebAuthn (uint, nint, bytes, text, array, map)
function decodeCBOR(data: Uint8Array, offset = 0): [unknown, number] {
  const b  = data[offset++];
  const mt = (b >> 5) & 0x7;
  const ai = b & 0x1f;
  let len: number;
  if      (ai < 24)  { len = ai; }
  else if (ai === 24) { len = data[offset++]; }
  else if (ai === 25) { len = (data[offset] << 8) | data[offset + 1]; offset += 2; }
  else if (ai === 26) { len = (data[offset] << 24) | (data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3]; offset += 4; }
  else                { len = 0; }

  if (mt === 0) return [len, offset];
  if (mt === 1) return [-(1 + len), offset];
  if (mt === 2) return [data.slice(offset, offset + len), offset + len];
  if (mt === 3) return [new TextDecoder().decode(data.slice(offset, offset + len)), offset + len];
  if (mt === 4) {
    const arr: unknown[] = [];
    for (let i = 0; i < len; i++) { const [v, o] = decodeCBOR(data, offset); arr.push(v); offset = o; }
    return [arr, offset];
  }
  const map: Record<string | number, unknown> = {};
  for (let i = 0; i < len; i++) {
    const [k, o1] = decodeCBOR(data, offset); offset = o1;
    const [v, o2] = decodeCBOR(data, offset); offset = o2;
    map[k as string | number] = v;
  }
  return [map, offset];
}

interface ParsedAuthData {
  signCount: number;
  aaguid?: string;
  credentialId?: Uint8Array;
  publicKeyCbor?: Uint8Array;
}

function parseAuthenticatorData(authData: Uint8Array): ParsedAuthData {
  let o = 32; // skip rpIdHash
  const flags     = authData[o++];
  const signCount = (authData[o] << 24) | (authData[o + 1] << 16) | (authData[o + 2] << 8) | authData[o + 3];
  o += 4;

  if (!(flags & 0x40)) return { signCount };

  const aaguidBytes = authData.slice(o, o + 16); o += 16;
  const hex    = Array.from(aaguidBytes).map((b) => b.toString(16).padStart(2, "0")).join("");
  const aaguid = `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;

  const credIdLen   = (authData[o] << 8) | authData[o + 1]; o += 2;
  const credentialId  = authData.slice(o, o + credIdLen); o += credIdLen;
  const publicKeyCbor = authData.slice(o);

  return { signCount, aaguid, credentialId, publicKeyCbor };
}

async function coseToKeyJson(coseBytes: Uint8Array): Promise<string> {
  const [cose] = decodeCBOR(coseBytes) as [Record<number, unknown>, number];
  const kty = cose[1], alg = cose[3];

  if (kty === 2 && (alg === -7 || alg === undefined)) {
    const jwk = { kty: "EC", crv: "P-256", x: b64url(cose[-2] as Uint8Array), y: b64url(cose[-3] as Uint8Array) };
    return JSON.stringify({ type: "EC2", jwk });
  }
  if (kty === 3 && alg === -257) {
    const jwk = { kty: "RSA", alg: "RS256", n: b64url(cose[-1] as Uint8Array), e: b64url(cose[-2] as Uint8Array) };
    return JSON.stringify({ type: "RSA", jwk });
  }
  throw new Error(`Unsupported COSE key type=${kty} alg=${alg}`);
}

// ECDSA signatures from authenticators are DER-encoded; Web Crypto expects raw r||s (64 bytes for P-256)
function derToRaw(der: Uint8Array): Uint8Array {
  let o = 2; // skip 0x30 + total length
  if (der[1] & 0x80) o += der[1] & 0x7f; // long-form length
  o++; // skip 0x02 (integer tag)
  const rLen = der[o++];
  const r = der.slice(o, o + rLen); o += rLen;
  o++; // skip 0x02
  const sLen = der[o++];
  const s = der.slice(o, o + sLen);
  // strip leading 0x00 padding, then left-pad to 32 bytes
  const raw = new Uint8Array(64);
  const rTrim = r[0] === 0 ? r.slice(1) : r;
  const sTrim = s[0] === 0 ? s.slice(1) : s;
  raw.set(rTrim, 32 - rTrim.length);
  raw.set(sTrim, 64 - sTrim.length);
  return raw;
}

async function verifyAssertion(db: any, rpId: string, credentialId: string, clientDataJSON: string, authenticatorData: string, signature: string, expectedType: string): Promise<{ ok: false; error: string } | { ok: true; cred: any; authDataBytes: Uint8Array }> {
  const cd = parseClientData(clientDataJSON);
  if (cd.type !== expectedType)      return { ok: false, error: "invalid_type" };

  const cred = await db.row("SELECT * FROM web_auth_credential WHERE credential_id = ?", [credentialId]);
  if (!cred) return { ok: false, error: "credential_not_found" };

  if (!verifyOrigin(cd, rpId)) return { ok: false, error: "invalid_origin" };

  const authDataBytes = b64urlDecode(authenticatorData);
  if (!await verifySignature(cred.public_key, authDataBytes, clientDataJSON, b64urlDecode(signature))) {
    return { ok: false, error: "invalid_signature" };
  }

  const { signCount } = parseAuthenticatorData(authDataBytes);
  await db.exec("UPDATE web_auth_credential SET sign_count = ?, last_used = ? WHERE id = ?", [signCount, now(), cred.id]);

  return { ok: true, cred, authDataBytes };
}

async function verifySignature(keyJson: string, authData: Uint8Array, clientDataJSON: string, sig: Uint8Array): Promise<boolean> {
  const { type, jwk } = JSON.parse(keyJson);
  const isEC    = type === "EC2";
  const keyAlgo = isEC ? { name: "ECDSA", namedCurve: "P-256" } : { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" };
  const sigAlgo = isEC ? { name: "ECDSA", hash: "SHA-256" }     : { name: "RSASSA-PKCS1-v1_5" };
  const key     = await crypto.subtle.importKey("jwk", jwk, keyAlgo, false, ["verify"]);

  const hash       = await crypto.subtle.digest("SHA-256", b64urlDecode(clientDataJSON).buffer as ArrayBuffer);
  const verifyData = new Uint8Array(authData.length + hash.byteLength);
  verifyData.set(authData);
  verifyData.set(new Uint8Array(hash), authData.length);

  const rawSig = isEC ? derToRaw(sig) : sig;
  return crypto.subtle.verify(sigAlgo, key, rawSig.buffer as ArrayBuffer, verifyData.buffer as ArrayBuffer);
}

// ─── RP config ────────────────────────────────────────────────────────────────

async function getRp(app: App): Promise<{ rpId: string; rpName: string }> {
  const rpId   = await app.settings.web_auth.rpId;
  const rpName = await app.settings.web_auth.rpName;
  return {
    rpId:   (rpId   && rpId   !== "null") ? String(rpId)   : "localhost",
    rpName: (rpName && rpName !== "null") ? String(rpName) : "Qino",
  };
}

// ─── API ──────────────────────────────────────────────────────────────────────

export function routes(app: App): void {
  app.aptTree.web_auth = buildApi(app);
}

function buildApi(app: App): AptTree { return {

  register: {
    challenge: {
      post: {
        description: "WebAuthn Registrierungs-Challenge anfordern",
        access: Access.USER,
        execute: async () => {
          const ctx = getCtx();
          const { rpId, rpName } = await getRp(app);
          const challenge = randB64(32);
          const token     = await storeChallenge(app.db, challenge, ctx.userId, "register");
          const usr       = await app.db.row("SELECT email, firstname, lastname FROM usr WHERE id = ?", [ctx.userId]);
          return {
            token,
            publicKey: {
              rp: { id: rpId, name: rpName },
              user: {
                id: b64url(new TextEncoder().encode(String(ctx.userId))),
                name: String(usr?.email ?? ctx.userId),
                displayName: [usr?.firstname, usr?.lastname].filter(Boolean).join(" ") || String(usr?.email ?? ctx.userId),
              },
              challenge,
              pubKeyCredParams: [{ alg: -7, type: "public-key" }, { alg: -257, type: "public-key" }],
              timeout: CHALLENGE_TTL * 1000,
              attestation: "none",
              authenticatorSelection: { authenticatorAttachment: "platform", residentKey: "preferred", userVerification: "preferred" },
            },
          };
        },
      },
    },

    verify: {
      post: {
        description: "WebAuthn Credential nach Registrierung speichern",
        access: Access.USER,
        input: s.object({
          token:             s.string(),
          clientDataJSON:    s.string(),
          attestationObject: s.string(),
          name:              s.optional(s.string()),
        }),
        execute: async ({ token, clientDataJSON, attestationObject, name }: any) => {
          const ctx    = getCtx();
          const stored = await consumeChallenge(app.db, token, "register");
          if (!stored)                       return { ok: false, error: "challenge_expired" };
          if (stored.usr_id !== ctx.userId)  return { ok: false, error: "user_mismatch" };

          const cd = parseClientData(clientDataJSON);
          if (cd.type !== "webauthn.create")     return { ok: false, error: "invalid_type" };
          if (cd.challenge !== stored.challenge) return { ok: false, error: "challenge_mismatch" };

          const { rpId } = await getRp(app);
          if (!verifyOrigin(cd, rpId))           return { ok: false, error: "invalid_origin" };

          const [attObj] = decodeCBOR(b64urlDecode(attestationObject)) as [Record<string, unknown>, number];
          const parsed   = parseAuthenticatorData(attObj.authData as Uint8Array);
          if (!parsed.credentialId || !parsed.publicKeyCbor) return { ok: false, error: "no_credential_data" };

          const credId = b64url(parsed.credentialId);
          if (await app.db.one("SELECT id FROM web_auth_credential WHERE credential_id = ?", [credId])) {
            return { ok: false, error: "already_registered" };
          }

          const t = now();
          await app.db.table("web_auth_credential").insert({
            usr_id: ctx.userId, credential_id: credId,
            public_key: await coseToKeyJson(parsed.publicKeyCbor),
            sign_count: parsed.signCount, aaguid: parsed.aaguid ?? "",
            name: String(name ?? "Authenticator"), created: t, last_used: t,
          });
          return { ok: true };
        },
      },
    },
  },

  login: {
    challenge: {
      post: {
        description: "WebAuthn Login-Challenge anfordern",
        access: Access.PUBLIC,
        input: s.object({ email: s.optional(s.string()) }),
        execute: async ({ email }: any) => {
          const { rpId }      = await getRp(app);
          const challenge      = randB64(32);
          let usrId            = 0;
          const allowCredentials: unknown[] = [];

          if (email) {
            const usr = await app.db.row("SELECT id FROM usr WHERE LOWER(TRIM(email)) = LOWER(?) AND active = 1", [String(email).trim()]);
            if (usr) {
              usrId = Number(usr.id);
              const creds = await app.db.all("SELECT credential_id FROM web_auth_credential WHERE usr_id = ?", [usrId]);
              for (const c of creds) allowCredentials.push({ id: c.credential_id, type: "public-key" });
            }
          }

          const token = await storeChallenge(app.db, challenge, usrId, "login");
          return {
            token,
            publicKey: {
              rpId, challenge,
              timeout: CHALLENGE_TTL * 1000,
              userVerification: "preferred",
              allowCredentials: allowCredentials.length ? allowCredentials : undefined,
            },
          };
        },
      },
    },

    verify: {
      post: {
        description: "WebAuthn Login verifizieren und Session erstellen",
        access: Access.PUBLIC,
        input: s.object({
          token:             s.string(),
          credentialId:      s.string(),
          clientDataJSON:    s.string(),
          authenticatorData: s.string(),
          signature:         s.string(),
        }),
        execute: async ({ token, credentialId, clientDataJSON, authenticatorData, signature }: any) => {
          const stored = await consumeChallenge(app.db, token, "login");
          if (!stored) return { ok: false, error: "challenge_expired" };
          if (parseClientData(clientDataJSON).challenge !== stored.challenge) return { ok: false, error: "challenge_mismatch" };

          const { rpId } = await getRp(app);
          const r = await verifyAssertion(app.db, rpId, credentialId, clientDataJSON, authenticatorData, signature, "webauthn.get");
          if (!r.ok) return r;

          if (stored.usr_id && Number(r.cred.usr_id) !== stored.usr_id) return { ok: false, error: "user_mismatch" };

          const usrId = Number(r.cred.usr_id);
          if (!(await app.db.row("SELECT id FROM usr WHERE id = ? AND active = 1", [usrId]))) return { ok: false, error: "user_inactive" };

          // sign_count must increase — protects against cloned authenticators (0 = not supported by device)
          const storedCount = Number(r.cred.sign_count);
          const newCount    = parseAuthenticatorData(r.authDataBytes).signCount;
          if (storedCount > 0 && newCount > 0 && newCount <= storedCount) return { ok: false, error: "sign_count_regression" };

          const ctx = getCtx();
          await login(ctx, usrId);
          app.sessions.setCookie(ctx);
          await app.fire("web_auth:login", { usr_id: usrId });
          return { ok: true };
        },
      },
    },
  },

  confirm: {
    challenge: {
      post: {
        description: "Step-up Challenge — Identität des eingeloggten Benutzers bestätigen",
        access: Access.USER,
        execute: async () => {
          const ctx   = getCtx();
          const { rpId } = await getRp(app);
          const challenge = randB64(32);
          const creds = await app.db.all("SELECT credential_id FROM web_auth_credential WHERE usr_id = ?", [ctx.userId]);
          const token = await storeChallenge(app.db, challenge, ctx.userId, "confirm");
          return {
            token,
            publicKey: {
              rpId, challenge,
              timeout: CHALLENGE_TTL * 1000,
              userVerification: "required",
              allowCredentials: creds.map((c: any) => ({ id: c.credential_id, type: "public-key" })),
            },
          };
        },
      },
    },

    verify: {
      post: {
        description: "Step-up Bestätigung verifizieren — setzt Session-Flag 'web_auth_confirmed'",
        access: Access.USER,
        input: s.object({
          token:             s.string(),
          credentialId:      s.string(),
          clientDataJSON:    s.string(),
          authenticatorData: s.string(),
          signature:         s.string(),
        }),
        execute: async ({ token, credentialId, clientDataJSON, authenticatorData, signature }: any) => {
          const ctx    = getCtx();
          const stored = await consumeChallenge(app.db, token, "confirm");
          if (!stored)                      return { ok: false, error: "challenge_expired" };
          if (stored.usr_id !== ctx.userId) return { ok: false, error: "user_mismatch" };
          if (parseClientData(clientDataJSON).challenge !== stored.challenge) return { ok: false, error: "challenge_mismatch" };

          const { rpId } = await getRp(app);
          const r = await verifyAssertion(app.db, rpId, credentialId, clientDataJSON, authenticatorData, signature, "webauthn.get");
          if (!r.ok) return r;

          ctx.session.web_auth_confirmed(now());
          return { ok: true };
        },
      },
    },
  },

  credentials: {
    get: {
      description: "Eigene WebAuthn-Credentials auflisten",
      access: Access.USER,
      execute: async () => {
        const ctx  = getCtx();
        const rows = await app.db.all(
          "SELECT id, credential_id, name, aaguid, created, last_used FROM web_auth_credential WHERE usr_id = ? ORDER BY created DESC",
          [ctx.userId],
        );
        return rows.map((r: any) => ({ id: r.id, credentialId: r.credential_id, name: r.name, aaguid: r.aaguid, created: r.created, lastUsed: r.last_used }));
      },
    },
  },

  credential: {
    ":credId": {
      paramSchema: s.number(),
      delete: {
        description: "WebAuthn-Credential löschen (eigenes oder als Superuser)",
        access: Access.USER,
        execute: async ({ credId }: any) => {
          const ctx  = getCtx();
          const cred = await app.db.row("SELECT usr_id FROM web_auth_credential WHERE id = ?", [credId]);
          if (!cred) return { ok: false, error: "not_found" };
          if (Number(cred.usr_id) !== ctx.userId && !(await ctx.user?.get("superuser"))) throw new AccessError();
          await app.db.exec("DELETE FROM web_auth_credential WHERE id = ?", [credId]);
          return { ok: true };
        },
      },
    },
  },

}; }
