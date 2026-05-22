/**
 * web_auth.js — WebAuthn Client
 *
 * import { WebAuth, initWebAuth } from "/m/web_auth/pub/web_auth.js";
 */

export class WebAuth {
  constructor(opts = {}) {
    this.apiBase = opts.apiBase ?? "/api/web_auth";
    this.opts    = opts;
  }

  // ── Fetch ─────────────────────────────────────────────────────────────────

  async #fetch(path, init = {}) {
    const res = await fetch(this.apiBase + path, { credentials: "same-origin", ...init });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }
  #post(path, body) { return this.#fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); }
  #del(path)        { return this.#fetch(path, { method: "DELETE" }); }

  // ── Encoding ──────────────────────────────────────────────────────────────

  static #enc(buf) {
    const b = new Uint8Array(buf);
    let s = "";
    for (const x of b) s += String.fromCharCode(x);
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
  }

  static #dec(str) {
    const p = str.replace(/-/g, "+").replace(/_/g, "/").padEnd(str.length + (4 - str.length % 4) % 4, "=");
    const b = atob(p), bytes = new Uint8Array(b.length);
    for (let i = 0; i < b.length; i++) bytes[i] = b.charCodeAt(i);
    return bytes.buffer;
  }

  // ── Register ──────────────────────────────────────────────────────────────

  async register(opts = {}) {
    if (!window.PublicKeyCredential) throw new Error("WebAuthn not supported.");

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
      if (e.name === "NotAllowedError") throw new Error("Abgebrochen.");
      throw e;
    }

    const result = await this.#post("/register/verify", {
      token,
      clientDataJSON:    WebAuth.#enc(credential.response.clientDataJSON),
      attestationObject: WebAuth.#enc(credential.response.attestationObject),
      name: opts.name ?? await this.#guessName(),
    });

    result.ok ? this.opts.onSuccess?.("register", result) : this.opts.onError?.("register", result);
    return result;
  }

  // ── Login ─────────────────────────────────────────────────────────────────

  async login(opts = {}) {
    if (!window.PublicKeyCredential) throw new Error("WebAuthn not supported.");

    const { token, publicKey } = await this.#post("/login/challenge", { email: opts.email ?? null });

    const getOptions = { ...publicKey, challenge: WebAuth.#dec(publicKey.challenge) };
    if (publicKey.allowCredentials?.length) {
      getOptions.allowCredentials = publicKey.allowCredentials.map((c) => ({ ...c, id: WebAuth.#dec(c.id) }));
    }

    let assertion;
    try {
      assertion = await navigator.credentials.get({ publicKey: getOptions });
    } catch (e) {
      if (e.name === "NotAllowedError") throw new Error("Abgebrochen.");
      throw e;
    }

    const result = await this.#verify(token, assertion);
    result.ok ? this.opts.onSuccess?.("login", result) : this.opts.onError?.("login", result);
    return result;
  }

  // ── Conditional UI (Autofill passkey) ─────────────────────────────────────

  async loginConditional() {
    if (!await WebAuth.isConditionalMediationAvailable()) return null;

    const { token, publicKey } = await this.#post("/login/challenge", {});
    let assertion;
    try {
      assertion = await navigator.credentials.get({
        publicKey: { ...publicKey, challenge: WebAuth.#dec(publicKey.challenge) },
        mediation: "conditional",
      });
    } catch (e) {
      if (e.name === "AbortError") return null;
      throw e;
    }

    const result = await this.#verify(token, assertion);
    result.ok ? this.opts.onSuccess?.("login", result) : this.opts.onError?.("login", result);
    return result;
  }

  #verify(token, a) {
    return this.#post("/login/verify", {
      token,
      credentialId:      WebAuth.#enc(a.rawId),
      clientDataJSON:    WebAuth.#enc(a.response.clientDataJSON),
      authenticatorData: WebAuth.#enc(a.response.authenticatorData),
      signature:         WebAuth.#enc(a.response.signature),
    });
  }

  // ── Step-up confirmation ──────────────────────────────────────────────────

  async confirm() {
    const { token, publicKey } = await this.#post("/confirm/challenge", {});
    const getOptions = {
      ...publicKey,
      challenge: WebAuth.#dec(publicKey.challenge),
      allowCredentials: publicKey.allowCredentials?.map((c) => ({ ...c, id: WebAuth.#dec(c.id) })),
    };
    let assertion;
    try {
      assertion = await navigator.credentials.get({ publicKey: getOptions });
    } catch (e) {
      if (e.name === "NotAllowedError") throw new Error("Abgebrochen.");
      throw e;
    }
    return this.#verify(token, assertion);
  }

  // ── Credential management ─────────────────────────────────────────────────

  listCredentials()    { return this.#fetch("/credentials"); }
  deleteCredential(id) { return this.#del(`/credential/${id}`); }

  // ── Static helpers ────────────────────────────────────────────────────────

  static isSupported() { return !!window.PublicKeyCredential; }

  static isPlatformAuthenticatorAvailable() {
    return WebAuth.isSupported() && PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  }

  static async isConditionalMediationAvailable() {
    return WebAuth.isSupported() && (await PublicKeyCredential.isConditionalMediationAvailable?.() ?? false);
  }

  async #guessName() {
    try {
      if (!await WebAuth.isPlatformAuthenticatorAvailable()) return "Hardware-Key";
      const ua = navigator.userAgent;
      if (/iPhone|iPad/i.test(ua)) return "Face ID / Touch ID";
      if (/Android/i.test(ua))     return "Android Biometrie";
      if (/Win/i.test(ua))         return "Windows Hello";
      if (/Mac/i.test(ua))         return "Touch ID";
      return "Plattform-Authenticator";
    } catch { return "Authenticator"; }
  }
}

// ── initWebAuth ───────────────────────────────────────────────────────────────
//
//   <button data-web-auth-action="login">Mit Passkey anmelden</button>
//   <button data-web-auth-action="register">Add passkey</button>
//   <input autocomplete="username webauthn" data-web-auth-action="conditional">

export function initWebAuth(opts = {}) {
  const wa        = new WebAuth(opts);
  const container = opts.container ?? document;

  for (const el of container.querySelectorAll("[data-web-auth-action]")) {
    const action = el.dataset.webAuthAction;

    if (action === "conditional") {
      wa.loginConditional().then((r) => { if (r?.ok) window.location.reload(); }).catch(console.error);
      continue;
    }

    el.addEventListener("click", async (e) => {
      e.preventDefault();
      const btn = e.currentTarget, prev = btn.textContent;
      btn.disabled = true;
      btn.textContent = action === "register" ? "Registrieren…" : "Anmelden…";

      try {
        let result;
        if (action === "register") {
          result = await wa.register({ name: container.querySelector("[data-web-auth-name]")?.value });
        } else if (action === "login") {
          result = await wa.login({ email: container.querySelector("[data-web-auth-email]")?.value });
        } else if (action === "delete") {
          const credId = btn.dataset.webAuthCredId;
          if (!credId || !confirm("Diesen Passkey wirklich entfernen?")) return;
          result = await wa.deleteCredential(credId);
          if (result.ok) btn.closest("[data-web-auth-credential]")?.remove();
          return;
        }
        if (result?.ok) {
          opts.onSuccess?.(action, result) ?? window.location.reload();
        } else {
          const label = action === "register" ? "Registrierung" : "Anmeldung";
          opts.onError?.(action, result) ?? alert(`${label} fehlgeschlagen: ${result?.error ?? "unbekannt"}`);
        }
      } catch (err) {
        console.error("[web_auth]", err);
        opts.onError?.(action, { error: err.message }) ?? alert(err.message);
      } finally {
        btn.disabled = false;
        btn.textContent = prev;
      }
    });
  }

  return wa;
}
