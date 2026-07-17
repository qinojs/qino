/**
 * web_auth.js — WebAuthn Client
 *
 * import { WebAuth } from "/m/web_auth/pub/web_auth.js";
 */

import { t } from "../../core/pub/js/qino.js";

const csrfHeaders = (method) =>
  method === "GET" || !globalThis.qino?.csrfToken ? {} : { "X-CSRF-Token": globalThis.qino.csrfToken };

export class WebAuth {
  constructor(opts = {}) {
    this.apiBase = opts.apiBase ?? "/api/web_auth";
  }

  // ── Fetch ─────────────────────────────────────────────────────────────────

  async #fetch(path, init = {}) {
    const method = (init.method ?? "GET").toUpperCase();
    const headers = { ...csrfHeaders(method), ...(init.headers ?? {}) };
    const res = await fetch(this.apiBase + path, { credentials: "same-origin", ...init, headers });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }
  #post(path, body) { return this.#fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); }
  #del(path)        { return this.#fetch(path, { method: "DELETE" }); }

  // ── Encoding ──────────────────────────────────────────────────────────────

  static #enc(buf) {
    let s = "";
    for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
    return btoa(s).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
  }

  static #dec(str) {
    const b = atob(str.replaceAll("-", "+").replaceAll("_", "/"));
    return Uint8Array.from(b, (c) => c.charCodeAt(0)).buffer;
  }

  // ── Register ──────────────────────────────────────────────────────────────

  async register(opts = {}) {
    if (!globalThis.PublicKeyCredential) throw new Error(await t`WebAuthn is not supported.`);

    const { token, publicKey } = await this.#post("/register/challenge", {});
    let credential;
    try {
      credential = await navigator.credentials.create({
        publicKey: {
          ...publicKey,
          challenge: WebAuth.#dec(publicKey.challenge),
          user: { ...publicKey.user, id: WebAuth.#dec(publicKey.user.id) },
        },
      });
    } catch (e) {
      if (e.name === "NotAllowedError") throw new Error(await t`Cancelled.`);
      throw e;
    }

    return this.#post("/register/verify", {
      token,
      credentialId:      WebAuth.#enc(credential.rawId),
      clientDataJSON:    WebAuth.#enc(credential.response.clientDataJSON),
      attestationObject: WebAuth.#enc(credential.response.attestationObject),
      name: opts.name ?? await this.guessName(),
    });
  }

  // ── Login ─────────────────────────────────────────────────────────────────

  async login(opts = {}) {
    if (!globalThis.PublicKeyCredential) throw new Error(await t`WebAuthn is not supported.`);

    const { token, publicKey } = await this.#post("/login/challenge", { email: opts.email ?? null });
    return this.#verify("/login/verify", token, await this.#getAssertion(publicKey));
  }

  // ── Conditional UI (Autofill passkey) ─────────────────────────────────────

  #conditionalAbort = null;

  async loginConditional() {
    if (!await WebAuth.isConditionalMediationAvailable()) return null;

    this.#conditionalAbort?.abort();
    this.#conditionalAbort = new AbortController();

    const { token, publicKey } = await this.#post("/login/challenge", {});
    let assertion;
    try {
      assertion = await navigator.credentials.get({
        publicKey: this.#decodePublicKey(publicKey),
        mediation: "conditional",
        signal: this.#conditionalAbort.signal,
      });
    } catch (e) {
      if (e.name === "AbortError") return null;
      throw e;
    }
    return this.#verify("/login/verify", token, assertion);
  }

  abortConditional() {
    this.#conditionalAbort?.abort();
    this.#conditionalAbort = null;
  }

  // ── Step-up confirmation ──────────────────────────────────────────────────

  async confirm() {
    const { token, publicKey } = await this.#post("/confirm/challenge", {});
    return this.#verify("/confirm/verify", token, await this.#getAssertion(publicKey));
  }

  // ── Credential management ─────────────────────────────────────────────────

  listCredentials()    { return this.#fetch("/credentials"); }
  deleteCredential(id) { return this.#del(`/credential/${id}`); }

  // ── Static helpers ────────────────────────────────────────────────────────

  static isSupported() { return !!globalThis.PublicKeyCredential; }

  static isPlatformAuthenticatorAvailable() {
    return WebAuth.isSupported() && PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  }

  static async isConditionalMediationAvailable() {
    return WebAuth.isSupported() && (await PublicKeyCredential.isConditionalMediationAvailable?.() ?? false);
  }

  async guessName() {
    try {
      if (!await WebAuth.isPlatformAuthenticatorAvailable()) return await t`Hardware key`;
      const ua = navigator.userAgent;
      if (/iPhone|iPad/i.test(ua)) return "Face ID / Touch ID";
      if (/Android/i.test(ua))     return await t`Android biometrics`;
      if (/Win/i.test(ua))         return "Windows Hello";
      if (/Mac/i.test(ua))         return "Touch ID";
      return await t`Platform authenticator`;
    } catch { return "Authenticator"; }
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  #decodePublicKey(pk) {
    return {
      ...pk,
      challenge: WebAuth.#dec(pk.challenge),
      allowCredentials: pk.allowCredentials?.map((c) => ({ ...c, id: WebAuth.#dec(c.id) })),
    };
  }

  async #getAssertion(publicKey) {
    let assertion;
    try {
      assertion = await navigator.credentials.get({ publicKey: this.#decodePublicKey(publicKey) });
    } catch (e) {
      if (e.name === "NotAllowedError") throw new Error(await t`Cancelled.`);
      throw e;
    }
    if (!assertion) throw new Error(await t`Cancelled.`);
    return assertion;
  }

  #verify(path, token, a) {
    return this.#post(path, {
      token,
      credentialId:      WebAuth.#enc(a.rawId),
      clientDataJSON:    WebAuth.#enc(a.response.clientDataJSON),
      authenticatorData: WebAuth.#enc(a.response.authenticatorData),
      signature:         WebAuth.#enc(a.response.signature),
    });
  }
}
