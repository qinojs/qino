import { cms } from "@qino/qino/cms";
import { adopt, before, moduleLink, page, prose, section, todo } from "@qino/qino/starter.cms";

import manifest from "./manifest.json" with { type: "json" };

import type { App } from "@qino/qino";
import type { Node } from "@qino/qino/cms";
import type { Texts } from "@qino/qino/starter.cms";

const { name } = manifest;

export function install({ app }: { app: App }): Promise<void> {
  return app.db.transaction(() => build(app));
}

async function build(app: App) {
  await adopt(app, name);
  const cm = cms(app);
  const root = await cm.node(1);

  // Passkeys on the login page of starter.cms, above the password form
  const login = (await cm.nodesByName("login")).values().find((node) => node.vs.type === "p");
  if (login && !await cm.nodeByModule("cms.cont.webauthn")) {
    const main = await login.cont("main");
    const first = (await main.conts())[0];
    const passkey = await main.cont("passkey", "cms.cont.webauthn");
    if (first) await main.insertBefore(passkey, first);
  }

  // Readable for everyone: guests get the login, the pages below ask them to sign in
  const shown = { access: 1, visible: true, searchable: false };
  const titles = { en: "My account", de: "Mein Konto", fr: "Mon compte", it: "Il mio account" };
  const account = await page(root, "account", titles, shown, async (p) => {
    await before(p, "first-steps");
    await prose(p, {
      en: "<h1>My account</h1>\n<p>Sign in here. Below you choose how you sign in and which devices stay signed in.</p>",
      de: "<h1>Mein Konto</h1>\n<p>Hier melden Sie sich an. Darunter legen Sie fest, wie Sie sich anmelden und welche Geräte angemeldet bleiben.</p>",
      fr: "<h1>Mon compte</h1>\n<p>Connectez-vous ici. Ci-dessous, vous choisissez comment vous vous connectez et quels appareils restent connectés.</p>",
      it: "<h1>Il mio account</h1>\n<p>Accedete qui. Qui sotto scegliete come accedere e quali dispositivi restano connessi.</p>",
    });
    await section(p, "cms.cont.login4");
  });

  const passkeys = { en: "Passkeys", de: "Passkeys", fr: "Clés d'accès", it: "Passkey" };
  await sub(account, "passkeys", passkeys, ["cms.cont.my.webauthn"], {
    en: "<h1>Passkeys</h1>\n<p>Sign in with your fingerprint, face or device PIN — no password to type or forget.</p>",
    de: "<h1>Passkeys</h1>\n<p>Melden Sie sich mit Fingerabdruck, Gesicht oder Geräte-PIN an — kein Passwort zum Tippen oder Vergessen.</p>",
    fr: "<h1>Clés d'accès</h1>\n<p>Connectez-vous avec votre empreinte, votre visage ou le code de l'appareil — sans mot de passe à saisir ni à oublier.</p>",
    it: "<h1>Passkey</h1>\n<p>Accedete con impronta, volto o PIN del dispositivo — nessuna password da digitare o dimenticare.</p>",
  });
  const twoFactor = { en: "Two-factor", de: "Zwei-Faktor", fr: "Double authentification", it: "Due fattori" };
  await sub(account, "two-factor", twoFactor, ["cms.cont.my.totp", "cms.cont.my.backup_codes"], {
    en: "<h1>Two-factor</h1>\n<p>A code from an authenticator app as a second step. Keep the backup codes for when the phone is gone.</p>",
    de: "<h1>Zwei-Faktor</h1>\n<p>Ein Code aus einer Authenticator-App als zweiter Schritt. Bewahren Sie die Backup-Codes für den Fall auf, dass das Telefon fehlt.</p>",
    fr: "<h1>Double authentification</h1>\n<p>Un code d'une application d'authentification comme deuxième étape. Gardez les codes de secours pour le jour où le téléphone manque.</p>",
    it: "<h1>Due fattori</h1>\n<p>Un codice da un'app di autenticazione come secondo passo. Conservate i codici di riserva per quando manca il telefono.</p>",
  });
  const devices = { en: "Devices", de: "Geräte", fr: "Appareils", it: "Dispositivi" };
  await sub(account, "devices", devices, ["cms.cont.my.clients"], {
    en: "<h1>Devices</h1>\n<p>Where you are signed in. Sign out a device you no longer use.</p>",
    de: "<h1>Geräte</h1>\n<p>Wo Sie angemeldet sind. Melden Sie ein Gerät ab, das Sie nicht mehr verwenden.</p>",
    fr: "<h1>Appareils</h1>\n<p>Où vous êtes connecté. Déconnectez un appareil que vous n'utilisez plus.</p>",
    it: "<h1>Dispositivi</h1>\n<p>Dove avete effettuato l'accesso. Disconnettete un dispositivo che non usate più.</p>",
  });

  const settings = await moduleLink(app, "cms.backend.settings", "Backend → Settings");
  await todo(app, "todo-passkeys", {
    en: `<h2>Passkeys</h2>\n<p>Passkeys are bound to a domain. Enter yours, without https:// (for example <code>example.com</code>), under ${settings} in <i>auth.webauthn → rpId</i> — until then they only work on localhost.</p>`,
    de: `<h2>Passkeys</h2>\n<p>Passkeys sind an eine Domain gebunden. Tragen Sie Ihre ohne https:// (zum Beispiel <code>example.com</code>) unter ${settings} bei <i>auth.webauthn → rpId</i> ein — bis dahin funktionieren sie nur auf localhost.</p>`,
    fr: `<h2>Clés d'accès</h2>\n<p>Les clés d'accès sont liées à un domaine. Indiquez le vôtre, sans https:// (par exemple <code>example.com</code>), sous ${settings} dans <i>auth.webauthn → rpId</i> — d'ici là, elles ne fonctionnent que sur localhost.</p>`,
    it: `<h2>Passkey</h2>\n<p>Le passkey sono legate a un dominio. Inserite il vostro, senza https:// (per esempio <code>example.com</code>), sotto ${settings} in <i>auth.webauthn → rpId</i> — fino ad allora funzionano solo su localhost.</p>`,
  });
}

/** A page below the account: an intro, then one section per module. */
async function sub(account: Node, name: string, titles: Texts, modules: string[], intro: Texts) {
  await page(account, name, titles, { access: 1, visible: true, searchable: false }, async (p) => {
    await prose(p, intro);
    for (const module of modules) await section(p, module);
  });
}
