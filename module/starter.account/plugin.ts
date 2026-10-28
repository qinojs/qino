import { cms } from "@qino/qino/cms";
import { adopt, before, page, prose, section } from "@qino/qino/starter.cms";

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
    await section(p, "cms.cont.login");
  });

  const profile = { en: "Profile", de: "Profil", fr: "Profil", it: "Profilo" };
  await page(account, "profile", profile, shown, async (p) => {
    await prose(p, {
      en: "<h1>Profile</h1>\n<p>The email address we reach you at, and your password.</p>",
      de: "<h1>Profil</h1>\n<p>Die E-Mail-Adresse, unter der wir Sie erreichen, und Ihr Passwort.</p>",
      fr: "<h1>Profil</h1>\n<p>L'adresse e-mail à laquelle nous vous joignons, et votre mot de passe.</p>",
      it: "<h1>Profilo</h1>\n<p>L'indirizzo e-mail al quale vi raggiungiamo, e la vostra password.</p>",
    });
    const emails = await section(p, "cms.cont.my.emails");
    await emails.settings.single(true); // most sites need one address; a site may allow more
    await section(p, "cms.cont.my.password");
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
  // accounts hold personal data: the privacy policy says so
  await (await cm.nodeByModule("cms.cont.privacy"))?.settings.account(true);
}

/** A page below the account: an intro, then one section per module. */
async function sub(account: Node, name: string, titles: Texts, modules: string[], intro: Texts) {
  await page(account, name, titles, { access: 1, visible: true, searchable: false }, async (p) => {
    await prose(p, intro);
    for (const module of modules) await section(p, module);
  });
}
