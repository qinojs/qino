// deno-lint-ignore-file no-explicit-any
import { getCtx, unixTime, b64url, unb64url, randB64, Access, AccessError, s } from "@qino/qino";
import { proof } from "@qino/qino/auth";
import { verifyAuthenticationResponse, verifyRegistrationResponse } from "@simplewebauthn/server";

import type { ApiTree, App, Db, Ctx } from "@qino/qino";
import type { Factor } from "@qino/qino/auth";
import type { Jobs } from "@qino/qino/cron";

export { default as dbSchema } from "./dbschema.json" with { type: "json" };

export const authFactors: Factor[] = [{ name: "webauthn", label: "Passkey", login: true, stepUp: true }];

export const settingsSchema = {
  properties: {
    rpId:   { type: "string", description: "Relying Party ID — domain without protocol, e.g. example.com" },
    rpName: { type: "string", description: "Display name of the application in the authenticator dialog" },
    origin: { type: "string", description: "Accepted origin(s), comma-separated, e.g. https://example.com:8443 — default: request origin if its host matches rpId" },
  },
};

export const cron = {
  challenges: {
    every: "hour",
    jitter: 15 * 60,
    run: (app) => app.db.exec`DELETE FROM webauthn_challenge WHERE expires < ${unixTime()}`,
  },
} satisfies Jobs;

// ─── Helpers ──────────────────────────────────────────────────────────────────

const CHALLENGE_TTL = 5 * 60;

async function getRp(app: App): Promise<{ rpId: string; rpName: string }> {
  const rpId   = String(await app.settings["auth.webauthn"].rpId   ?? "") || "localhost";
  const rpName = String(await app.settings["auth.webauthn"].rpName ?? "") || "Qino";
  return { rpId, rpName };
}

/** Origins accepted in clientDataJSON — `origin` setting (comma-separated) or derived from the request. */
async function expectedOrigins(ctx: Ctx, rpId: string): Promise<string[]> {
  const setting = String(await ctx.app.settings["auth.webauthn"].origin ?? "");
  if (setting) return setting.split(",").map((s) => s.trim()).filter(Boolean);
  const url = ctx.req.url;
  if (url.hostname === rpId || url.hostname.endsWith("." + rpId)) return [url.origin];
  return [rpId === "localhost" ? "http://localhost" : `https://${rpId}`];
}

async function storeChallenge(db: Db, challenge: string, usrId: number, type: "register" | "login" | "confirm"): Promise<string> {
  const token = randB64(24);
  await db.table("webauthn_challenge").insert({ token, challenge, usr_id: usrId, type, expires: unixTime() + CHALLENGE_TTL });
  return token;
}

async function consumeChallenge(db: Db, token: string, type: string): Promise<{ challenge: string; usr_id: number } | null> {
  const row = await db.row`SELECT challenge, usr_id FROM webauthn_challenge WHERE token = ${token} AND type = ${type} AND expires > ${unixTime()}`;
  if (!row) return null;
  // the delete decides the race: of parallel verifies only one gets a successful delete
  if (!await db.table("webauthn_challenge").delete(token)) return null;
  return { challenge: row.challenge, usr_id: Number(row.usr_id) };
}

// shared request shape for the two assertion-verify endpoints (login + step-up confirm)
const assertionInput = s.object({
  token:             s.string(),
  credentialId:      s.string(),
  clientDataJSON:    s.string(),
  authenticatorData: s.string(),
  signature:         s.string(),
});

async function verifyAssertion(
  ctx: Ctx,
  { credentialId, clientDataJSON, authenticatorData, signature }: any,
  expectedChallenge: string,
  requireUserVerification: boolean,
): Promise<{ ok: false; error: string } | { ok: true; cred: any; newCounter: number }> {
  const cred = await ctx.app.db.row`SELECT * FROM webauthn_credential WHERE credential_id = ${credentialId}`;
  if (!cred) return { ok: false, error: "credential_not_found" };

  const { rpId } = await getRp(ctx.app);
  const expectedOrigin = await expectedOrigins(ctx, rpId);
  try {
    const { verified, authenticationInfo } = await verifyAuthenticationResponse({
      response: {
        id: credentialId, rawId: credentialId,
        response: { clientDataJSON, authenticatorData, signature },
        type: "public-key",
        clientExtensionResults: {},
      },
      expectedChallenge,
      expectedOrigin,
      expectedRPID: rpId,
      credential: {
        id: credentialId,
        publicKey: unb64url(cred.public_key),
        counter: Number(cred.sign_count),
      },
      requireUserVerification,
    });
    if (!verified) return { ok: false, error: "verification_failed" };
    return { ok: true, cred, newCounter: authenticationInfo.newCounter };
  } catch {
    return { ok: false, error: "verification_failed" };
  }
}

// ─── API ──────────────────────────────────────────────────────────────────────

export const api: ApiTree = {

  register: {
    challenge: {
      post: {
        description: "Request WebAuthn registration challenge",
        access: Access.USER,
        execute: async () => {
          const ctx = getCtx();
          const db  = ctx.app.db;
          const { rpId, rpName } = await getRp(ctx.app);
          const challenge = randB64(32);
          const token     = await storeChallenge(db, challenge, ctx.userId, "register");
          const usr       = await db.row`SELECT email, firstname, lastname FROM usr WHERE id = ${ctx.userId}`;
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
        description: "Save WebAuthn credential after registration",
        access: Access.USER,
        input: s.object({
          token:             s.string(),
          credentialId:      s.string(),
          clientDataJSON:    s.string(),
          attestationObject: s.string(),
          name:              s.optional(s.string()),
        }),
        execute: async ({ token, credentialId, clientDataJSON, attestationObject, name }: any) => {
          const ctx    = getCtx();
          const db     = ctx.app.db;
          const stored = await consumeChallenge(db, token, "register");
          if (!stored)                      return { ok: false, error: "challenge_expired" };
          if (stored.usr_id !== ctx.userId) return { ok: false, error: "user_mismatch" };

          const { rpId } = await getRp(ctx.app);
          const expectedOrigin = await expectedOrigins(ctx, rpId);
          let verification: Awaited<ReturnType<typeof verifyRegistrationResponse>>;
          try {
            verification = await verifyRegistrationResponse({
              response: {
                id: credentialId, rawId: credentialId,
                response: { clientDataJSON, attestationObject },
                type: "public-key",
                clientExtensionResults: {},
              },
              expectedChallenge: stored.challenge,
              expectedOrigin,
              expectedRPID: rpId,
              requireUserVerification: false,
            });
          } catch {
            return { ok: false, error: "verification_failed" };
          }

          if (!verification.verified || !verification.registrationInfo) {
            return { ok: false, error: "verification_failed" };
          }

          const { credential, aaguid } = verification.registrationInfo;
          const credId = credential.id;

          if (await db.one`SELECT id FROM webauthn_credential WHERE credential_id = ${credId}`) {
            return { ok: false, error: "already_registered" };
          }

          const t = unixTime();
          await db.table("webauthn_credential").insert({
            usr_id: ctx.userId,
            credential_id: credId,
            public_key: b64url(credential.publicKey),
            sign_count: credential.counter,
            aaguid: aaguid ?? "",
            name: String(name ?? "Authenticator"),
            created: t, last_used: t,
          });
          return { ok: true };
        },
      },
    },
  },

  login: {
    challenge: {
      post: {
        description: "Request WebAuthn login challenge",
        access: Access.PUBLIC,
        input: s.object({ email: s.optional(s.string()) }),
        execute: async ({ email }: any) => {
          const ctx = getCtx();
          const db = ctx.app.db;
          const { rpId } = await getRp(ctx.app);
          const challenge = randB64(32);
          let usrId = 0;
          const allowCredentials = [];

          if (email) {
            const usr = await db.row`SELECT id FROM usr WHERE LOWER(TRIM(email)) = LOWER(${String(email).trim()}) AND active = ${true}`;
            if (usr) {
              usrId = Number(usr.id);
              const creds = await db.query`SELECT credential_id FROM webauthn_credential WHERE usr_id = ${usrId}`;
              for (const c of creds) allowCredentials.push({ id: c.credential_id, type: "public-key" });
            } else {
              ctx.app.fire("suspicious", { ctx, reason: "webauthn login challenge for unknown email" }).catch(() => {});
            }
          }

          const token = await storeChallenge(db, challenge, usrId, "login");
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
        description: "Verify WebAuthn login and create session",
        access: Access.PUBLIC,
        input: assertionInput,
        execute: async ({ token, credentialId, clientDataJSON, authenticatorData, signature }: any) => {
          const ctx = getCtx();
          const db = ctx.app.db;
          const stored = await consumeChallenge(db, token, "login");
          if (!stored) return { ok: false, error: "challenge_expired" };

          const r = await verifyAssertion(ctx, { credentialId, clientDataJSON, authenticatorData, signature }, stored.challenge, false);
          if (!r.ok) {
            ctx.app.fire("suspicious", { ctx, reason: "webauthn login verification failed" }).catch(() => {});
            return r;
          }

          if (stored.usr_id && Number(r.cred.usr_id) !== stored.usr_id) return { ok: false, error: "user_mismatch" };

          const usrId = Number(r.cred.usr_id);
          await db.table("webauthn_credential").update(r.cred.id, { sign_count: r.newCounter, last_used: unixTime() });

          if (!await proof(ctx, "webauthn", usrId)) return { ok: false, error: "user_inactive" };
          return { ok: true };
        },
      },
    },
  },

  confirm: {
    challenge: {
      post: {
        description: "Step-up challenge — confirm identity of the logged-in user",
        access: Access.USER,
        execute: async () => {
          const ctx = getCtx();
          const db  = ctx.app.db;
          const { rpId } = await getRp(ctx.app);
          const challenge = randB64(32);
          const creds = await db.query`SELECT credential_id FROM webauthn_credential WHERE usr_id = ${ctx.userId}`;
          const token = await storeChallenge(db, challenge, ctx.userId, "confirm");
          return {
            token,
            publicKey: {
              rpId, challenge,
              timeout: CHALLENGE_TTL * 1000,
              userVerification: "required",
              allowCredentials: creds.map((c) => ({ id: c.credential_id, type: "public-key" })),
            },
          };
        },
      },
    },

    verify: {
      post: {
        description: "Verify step-up confirmation — records a fresh proof in the session",
        access: Access.USER,
        input: assertionInput,
        execute: async ({ token, credentialId, clientDataJSON, authenticatorData, signature }: any) => {
          const ctx    = getCtx();
          const db     = ctx.app.db;
          const stored = await consumeChallenge(db, token, "confirm");
          if (!stored)                      return { ok: false, error: "challenge_expired" };
          if (stored.usr_id !== ctx.userId) return { ok: false, error: "user_mismatch" };

          const r = await verifyAssertion(ctx, { credentialId, clientDataJSON, authenticatorData, signature }, stored.challenge, true);
          if (!r.ok) return r;
          if (Number(r.cred.usr_id) !== ctx.userId) return { ok: false, error: "user_mismatch" };

          await db.table("webauthn_credential").update(r.cred.id, { sign_count: r.newCounter, last_used: unixTime() });
          if (!await proof(ctx, "webauthn", ctx.userId)) return { ok: false, error: "no_session_to_confirm" };
          return { ok: true };
        },
      },
    },
  },

  credentials: {
    get: {
      description: "List own WebAuthn credentials",
      access: Access.USER,
      execute: async () => {
        const ctx  = getCtx();
        const rows = await ctx.app.db.query`SELECT id, credential_id, name, aaguid, created, last_used FROM webauthn_credential WHERE usr_id = ${ctx.userId} ORDER BY created DESC`;
        return rows.map((r) => ({ id: r.id, credentialId: r.credential_id, name: r.name, aaguid: r.aaguid, created: r.created, lastUsed: r.last_used }));
      },
    },
  },

  credential: {
    ":credId": {
      paramSchema: s.number(),
      delete: {
        description: "Delete WebAuthn credential (own or as superuser)",
        access: Access.USER,
        execute: async ({ credId }: any) => {
          const ctx  = getCtx();
          const cred = await ctx.app.db.row`SELECT usr_id FROM webauthn_credential WHERE id = ${credId}`;
          if (!cred) return { ok: false, error: "not_found" };
          if (Number(cred.usr_id) !== ctx.userId && !(ctx.user?.superuser)) throw new AccessError();
          await ctx.app.db.table("webauthn_credential").delete(credId);
          return { ok: true };
        },
      },
    },
  },

};
