import { cms } from "@qino/qino/cms";
import { adopt, before, page, prose, section } from "@qino/qino/starter.cms";

import manifest from "./manifest.json" with { type: "json" };

import type { App } from "@qino/qino";

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
      en: "<h1>Profile</h1>\n<p>The email address we reach you at.</p>",
      de: "<h1>Profil</h1>\n<p>Die E-Mail-Adresse, unter der wir Sie erreichen.</p>",
      fr: "<h1>Profil</h1>\n<p>L'adresse e-mail à laquelle nous vous joignons.</p>",
      it: "<h1>Profilo</h1>\n<p>L'indirizzo e-mail al quale vi raggiungiamo.</p>",
    });
    const emails = await section(p, "cms.cont.my.emails");
    await emails.settings.single(true); // most sites need one address; a site may allow more
  });
  const security = { en: "Security", de: "Sicherheit", fr: "Sécurité", it: "Sicurezza" };
  const modules = [
    "cms.cont.my.password", "cms.cont.my.webauthn", "cms.cont.my.totp", "cms.cont.my.backup_codes",
    "cms.cont.my.oauth", "cms.cont.my.clients",
  ];
  await page(account, "security", security, shown, async (p) => {
    await prose(p, {
      en: "<h1>Security</h1>\n<p>How you sign in: password, passkeys with fingerprint, face or device PIN, a code from an authenticator app as a second step, with backup codes for when the phone is gone, and other services you sign in with. At the end, the devices where you are signed in.</p>",
      de: "<h1>Sicherheit</h1>\n<p>Wie Sie sich anmelden: Passwort, Passkeys mit Fingerabdruck, Gesicht oder Geräte-PIN, ein Code aus einer Authenticator-App als zweiter Schritt, mit Backup-Codes für den Fall, dass das Telefon fehlt, und andere Dienste, über die Sie sich anmelden. Am Schluss die Geräte, auf denen Sie angemeldet sind.</p>",
      fr: "<h1>Sécurité</h1>\n<p>Comment vous vous connectez : mot de passe, clés d'accès avec empreinte, visage ou code de l'appareil, un code d'une application d'authentification comme deuxième étape, avec des codes de secours pour le jour où le téléphone manque, et d'autres services par lesquels vous vous connectez. À la fin, les appareils sur lesquels vous êtes connecté.</p>",
      it: "<h1>Sicurezza</h1>\n<p>Come accedete: password, passkey con impronta, volto o PIN del dispositivo, un codice da un'app di autenticazione come secondo passo, con codici di riserva per quando manca il telefono, e altri servizi con cui accedete. Alla fine, i dispositivi su cui avete effettuato l'accesso.</p>",
    });
    for (const module of modules) await section(p, module);
  });
  // accounts hold personal data: the privacy policy says so
  await (await cm.nodeByModule("cms.cont.privacy"))?.settings.account(true);
}

