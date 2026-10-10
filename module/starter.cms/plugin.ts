import { fs, pwHash } from "@qino/qino";
import { cms } from "@qino/qino/cms";

import { adopt, before, link, moduleLink, page, prose, redirect, section, text, todo } from "./mod.ts";
import manifest from "./manifest.json" with { type: "json" };

import type { App } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

const { name } = manifest;
const LAYOUT = "cms.layout.standard.2";

// Atomic: half a site would be hard to tell from a finished one.
export function install({ app }: { app: App }): Promise<void> {
  return app.db.transaction(() => build(app));
}

async function build(app: App) {
  const { settings } = app;
  await adopt(app, name);
  if (!await settings.core.langs) await settings.core.langs("en");
  if (!await settings.cms.frontend) await settings.cms.frontend("cms.frontend.4");

  const root = await cms(app).node(1);
  // cms starts the root on a bare fallback; a layout the site already chose stays
  if (!cms(app).getLayouts()[String(root.vs.module)]) await root.set("module", LAYOUT);

  await root.changeGroup(await editors(app), 2); // before the pages: children copy the grants
  await superuser(app);

  const login = await systemPages(app, root); // first: page 5 must not be taken
  const home = await page(root, "home", TITLES.home, { access: 1, visible: true, searchable: true },
    (p) => prose(p, welcome(login)));
  await redirect(app, "", home);
  // signed in, the login page has nothing more to offer: on to the site, where editing starts
  const form = (await (await login.cont("main")).conts()).find((c) => c.vs.module === "cms.cont.login4");
  if (form && !await form.settings.redirect()) await form.settings.redirect(home.id);

  const contact = await page(root, "contact", TITLES.contact, { access: 1, visible: true, searchable: true }, contactForm);
  const hidden = { access: 1, visible: false, searchable: false };
  const search = await page(root, "search", TITLES.search, hidden, (p) => section(p, "cms.cont.search1"));
  const imprint = await page(root, "imprint", TITLES.imprint, hidden, (p) => prose(p, IMPRINT));
  const privacy = await page(root, "privacy", TITLES.privacy, hidden, (p) => prose(p, PRIVACY));

  // The footer belongs to the layout, so every page shows it
  const foot = await (await cms(app).layoutPage(LAYOUT)).cont("foot", "cms.cont.flexible");
  if (!(await foot.conts()).length) {
    await foot.settings.__inited(true);
    const links = (texts: Record<string, string>) => Object.fromEntries(Object.entries(texts).map(([lang, labels]) => {
      const [a, b, c, d] = labels.split("|");
      return [lang, `<p>${link(contact, a)} · ${link(imprint, b)} · ${link(privacy, c)} · ${link(search, d)}</p>`];
    }));
    await text(await foot.createCont({ module: "cms.cont.text" }), "main", links({
      en: "Contact|Imprint|Privacy policy|Search",
      de: "Kontakt|Impressum|Datenschutz|Suche",
      fr: "Contact|Mentions légales|Protection des données|Recherche",
      it: "Contatto|Colophon|Protezione dei dati|Ricerca",
    }));
  }
  await firstSteps(app, root, imprint, privacy);
}

/**
 * The order an editor finds in the page tree: the menu, the checklist, the pages only linked to,
 * then what runs the site. Later starters put their menu pages before the checklist.
 */
async function arrange(app: App, firstSteps: Node) {
  await before(firstSteps, "search");
  const system = (await cms(app).nodesByName("system")).values().find((node) => node.vs.type === "p");
  if (system) await before(system);
  const backend = await cms(app).nodeByModule("cms.backend");
  if (backend) await before(await backend.page());
}

/**
 * A checklist for whoever runs the site: private, so only editors see it in the navigation. Later
 * starters add their items with todo().
 */
async function firstSteps(app: App, root: Node, imprint: Node, privacy: Node) {
  await page(root, "first-steps", TITLES.firstSteps, { access: 0, visible: true, searchable: false }, async (p) => {
    await arrange(app, p);
    await prose(p, {
    en: "<h1>First steps</h1>\n<p>Only editors see this page. Work through it, then delete it in the page tree. New to the editor? In edit mode, the panel offers a guided <i>CMS tour</i> under <i>More</i>.</p>",
    de: "<h1>Erste Schritte</h1>\n<p>Nur Redakteure sehen diese Seite. Arbeiten Sie sie durch und löschen Sie sie dann im Seitenbaum. Neu im Editor? Im Bearbeitungsmodus startet das Panel unter <i>Mehr</i> die <i>CMS-Tour</i>.</p>",
    fr: "<h1>Premiers pas</h1>\n<p>Seuls les rédacteurs voient cette page. Parcourez-la, puis supprimez-la dans l'arborescence. Nouveau dans l'éditeur ? En mode édition, le panneau propose la <i>Visite guidée du CMS</i> sous <i>Plus</i>.</p>",
    it: "<h1>Primi passi</h1>\n<p>Solo i redattori vedono questa pagina. Seguitela, poi eliminatela nell'albero delle pagine. Nuovi nell'editor? In modalità modifica, il pannello avvia il <i>tour del CMS</i> sotto <i>Altro</i>.</p>",
    });
  });
  const users = await moduleLink(app, "cms.backend.users", "Backend → Users");
  await todo(app, "todo-account", {
    en: `<h2>Your own account</h2>\n<p>Create a user for yourself under ${users} and put them in the group <i>admin</i>. Keep the superuser <i>su</i> for emergencies, with a password of your own, and delete the file <code>data/starter.cms/superuser.txt</code> on the server.</p>`,
    de: `<h2>Ihr eigenes Konto</h2>\n<p>Legen Sie unter ${users} einen Benutzer für sich an und nehmen Sie ihn in die Gruppe <i>admin</i> auf. Den Superuser <i>su</i> behalten Sie für Notfälle, mit einem eigenen Passwort, und löschen auf dem Server die Datei <code>data/starter.cms/superuser.txt</code>.</p>`,
    fr: `<h2>Votre propre compte</h2>\n<p>Créez un utilisateur pour vous sous ${users} et ajoutez-le au groupe <i>admin</i>. Gardez le superutilisateur <i>su</i> pour les urgences, avec votre propre mot de passe, et supprimez sur le serveur le fichier <code>data/starter.cms/superuser.txt</code>.</p>`,
    it: `<h2>Il vostro account</h2>\n<p>Create un utente per voi sotto ${users} e aggiungetelo al gruppo <i>admin</i>. Tenete il superutente <i>su</i> per le emergenze, con una vostra password, ed eliminate sul server il file <code>data/starter.cms/superuser.txt</code>.</p>`,
  });
  const identity = await moduleLink(app, "cms.backend.config.identity", "Backend → Configuration → Identity");
  await todo(app, "todo-identity", {
    en: `<h2>Name, logo and colours</h2>\n<p>Under ${identity}. The email address entered there receives the messages of the contact form.</p>`,
    de: `<h2>Name, Logo und Farben</h2>\n<p>Unter ${identity}. An die dort eingetragene E-Mail-Adresse gehen die Nachrichten des Kontaktformulars.</p>`,
    fr: `<h2>Nom, logo et couleurs</h2>\n<p>Sous ${identity}. L'adresse e-mail indiquée reçoit les messages du formulaire de contact.</p>`,
    it: `<h2>Nome, logo e colori</h2>\n<p>Sotto ${identity}. L'indirizzo e-mail indicato riceve i messaggi del modulo di contatto.</p>`,
  });
  const mail = await moduleLink(app, "cms.backend.superuser.messaging.email", "Backend → Superuser → Messaging → Email");
  const entries = await moduleLink(app, "cms.backend.cms.form4", "Backend → CMS → Form entries");
  await todo(app, "todo-mail", {
    en: `<h2>Sending email</h2>\n<p>Set up a mail server under ${mail}. Until then no mail leaves the site; messages from the contact form still arrive under ${entries}.</p>`,
    de: `<h2>E-Mail-Versand</h2>\n<p>Richten Sie unter ${mail} einen Mailserver ein. Bis dahin verlässt keine Mail die Website; Nachrichten aus dem Kontaktformular finden Sie trotzdem unter ${entries}.</p>`,
    fr: `<h2>Envoi d'e-mails</h2>\n<p>Configurez un serveur de messagerie sous ${mail}. D'ici là, aucun e-mail ne part du site ; les messages du formulaire de contact arrivent quand même sous ${entries}.</p>`,
    it: `<h2>Invio di e-mail</h2>\n<p>Configurate un server di posta sotto ${mail}. Fino ad allora nessuna e-mail lascia il sito; i messaggi del modulo di contatto arrivano comunque sotto ${entries}.</p>`,
  });
  await todo(app, "todo-legal", {
    en: `<h2>Imprint and privacy policy</h2>\n<p>Replace the [placeholders] in the ${link(imprint, "imprint")} and the ${link(privacy, "privacy policy")}.</p>`,
    de: `<h2>Impressum und Datenschutz</h2>\n<p>Ersetzen Sie die [Platzhalter] im ${link(imprint, "Impressum")} und in der ${link(privacy, "Datenschutzerklärung")}.</p>`,
    fr: `<h2>Mentions légales et protection des données</h2>\n<p>Remplacez les [espaces réservés] dans les ${link(imprint, "mentions légales")} et la ${link(privacy, "déclaration de protection des données")}.</p>`,
    it: `<h2>Colophon e protezione dei dati</h2>\n<p>Sostituite i [segnaposto] nel ${link(imprint, "colophon")} e nella ${link(privacy, "dichiarazione sulla protezione dei dati")}.</p>`,
  });
  const settings = await moduleLink(app, "cms.backend.settings", "Backend → Settings");
  await todo(app, "todo-languages", {
    en: `<h2>Languages</h2>\n<p>The site speaks English. More languages are set under ${settings} in <i>core → langs</i>, for example <code>de,en</code> — the first one is the default. Titles and texts of these pages already exist in German, French and Italian.</p>`,
    de: `<h2>Sprachen</h2>\n<p>Die Website spricht Englisch. Weitere Sprachen stellen Sie unter ${settings} bei <i>core → langs</i> ein, zum Beispiel <code>de,en</code> — die erste ist die Standardsprache. Titel und Texte dieser Seiten gibt es bereits auf Deutsch, Französisch und Italienisch.</p>`,
    fr: `<h2>Langues</h2>\n<p>Le site parle anglais. D'autres langues se règlent sous ${settings} dans <i>core → langs</i>, par exemple <code>fr,en</code> — la première est la langue par défaut. Les titres et textes de ces pages existent déjà en allemand, français et italien.</p>`,
    it: `<h2>Lingue</h2>\n<p>Il sito parla inglese. Altre lingue si impostano sotto ${settings} in <i>core → langs</i>, per esempio <code>it,en</code> — la prima è quella predefinita. Titoli e testi di queste pagine esistono già in tedesco, francese e italiano.</p>`,
  });
}

/** The group for the site's editors: it may edit every page. Users are added in the backend. */
async function editors(app: App): Promise<number> {
  const id = await app.db.one`SELECT id FROM grp WHERE name = 'admin'`;
  return Number(id ?? await app.db.table("grp").insert({ name: "admin", cms_access: 3 }));
}

/** A superuser with a random password, shown once in the log and kept in a file only the server's
 *  user can read — the log is easily missed. */
async function superuser(app: App) {
  if (await app.db.one`SELECT id FROM usr WHERE superuser = ${true}`) return;
  // no lookalikes (0/O, 1/l/I), and only symbols that are safe in a shell (no ! # $ % & ? * ~)
  const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789-_.+=@";
  const pw = Array.from(crypto.getRandomValues(new Uint8Array(14)), (b) => chars[b % chars.length]).join("");
  await app.db.table("usr").insert({
    username: "su", pw: await pwHash(pw), superuser: true, active: true,
    given_name: "Superuser", family_name: "Superuser",
  });
  const file = app.modules.get(name)!.data + "superuser.txt";
  const kept = await fs.mkdir(file.replace(/[^/]+$/, ""), { mode: 0o700 })
    .then(() => fs.write(file, `email: su\npassword: ${pw}\n`, { mode: 0o600 })).then(() => true, () => false);
  // the color code ends before the password, so copying it doesn't include escape sequences
  const hint = kept ? `\n\x1b[33m[qino] Also written to ${file} — delete it once you are in.\x1b[0m` : "";
  console.log(`\n\x1b[33m[qino] Superuser created — sign in at /login with email: su  password:\x1b[0m ${pw}${hint}\n`);
}

/** Hidden pages the CMS itself relies on. Page 5 is where cms keeps the global layout pages. */
async function systemPages(app: App, root: Node) {
  const { db, settings } = app;
  const cm = cms(app);
  const system = await page(root, "system", TITLES.system, { access: 0, visible: false, searchable: false });
  if (!await db.one`SELECT id FROM page WHERE id = 5`) {
    await page(system, "layout", TITLES.layout, { id: 5, access: 1, visible: false });
  }
  const plain = { access: 1, visible: false, searchable: false, module: "cms.layout.system" };
  // a page setting that is unset or points nowhere
  const missing = async (setting: unknown) => {
    const id = Number(await setting);
    return !id || !(await cm.node(id)).exists();
  };

  const reset = await page(system, "password", TITLES.password, plain,
    async (p) => (await p.cont("main")).cont("1", "cms.cont.pwReset"));
  const login = await page(system, "login", TITLES.login, plain, async (p) => {
    await before(p, "password");
    const main = await p.cont("main");
    await main.cont("1", "cms.cont.login4");
    await text(await main.cont("2", "cms.cont.text"), "main", {
      en: `<p>${link(reset, "Forgot your password?")}</p>`,
      de: `<p>${link(reset, "Passwort vergessen?")}</p>`,
      fr: `<p>${link(reset, "Mot de passe oublié ?")}</p>`,
      it: `<p>${link(reset, "Password dimenticata?")}</p>`,
    });
  });
  await redirect(app, "login", login);

  // In the site's own layout: visitors land here from anywhere
  const shown = { access: 1, visible: false, searchable: false };
  if (await missing(settings.cms.pageNoAccess)) {
    const p = await page(system, "no-access", TITLES.noAccess, shown, (p) => section(p, "cms.cont.login4"));
    await settings.cms.pageNoAccess(p.id);
    if (!await settings.cms.pageOffline) await settings.cms.pageOffline(p.id);
  }
  if (await missing(settings.cms.pageNotFound)) {
    const p = await page(system, "not-found", TITLES.notFound, shown, (p) => section(p, "cms.cont.not_found1"));
    await settings.cms.pageNotFound(p.id);
  }
  if (await missing(settings.cms.pageTrash)) {
    const p = await page(system, "trash", TITLES.trash, { ...plain, access: 0 },
      async (p) => (await p.cont("main")).cont("1", "cms.cont.trash"));
    await settings.cms.pageTrash(p.id);
  }
  return login;
}

async function contactForm(p: Node) {
  await prose(p, {
    en: "<h1>Contact</h1>\n<p>Write to us — we will get back to you as soon as possible.</p>",
    de: "<h1>Kontakt</h1>\n<p>Schreiben Sie uns — wir melden uns so bald wie möglich.</p>",
    fr: "<h1>Contact</h1>\n<p>Écrivez-nous — nous vous répondrons dès que possible.</p>",
    it: "<h1>Contatto</h1>\n<p>Scriveteci — vi risponderemo il prima possibile.</p>",
  });
  // cms.cont.form4 creates the same two contents on its first render; done here, they hold fields
  const form = await section(p, "cms.cont.form4");
  await form.settings.__inited(true);
  const fields = await form.cont("main", "cms.cont.form4.fields");
  const spec = [
    ["name", "text", "name", { en: "Name", de: "Name", fr: "Nom", it: "Nome" }],
    ["email", "email", "email", { en: "Email", de: "E-Mail", fr: "E-mail", it: "E-mail" }],
    ["message", "textarea", "", { en: "Message", de: "Nachricht", fr: "Message", it: "Messaggio" }],
  ] as const;
  for (const [field, type, autocomplete, labels] of spec) {
    await fields.settings.fields[field]({ type, required: true, ...(autocomplete && { autocomplete }) });
    await text(fields, field + "_title", labels);
  }
  await fields.settings.sort(spec.map(([field]) => field).join(","));
  await text(await form.cont("success", "cms.cont.text"), "main", {
    en: "<p>Thank you! We will take care of your request as soon as possible.</p>",
    de: "<p>Vielen Dank! Wir kümmern uns so bald wie möglich um Ihr Anliegen.</p>",
    fr: "<p>Merci ! Nous traiterons votre demande dans les plus brefs délais.</p>",
    it: "<p>Grazie! Ci occuperemo della vostra richiesta il prima possibile.</p>",
  });
}

const TITLES = {
  home: { en: "Home", de: "Startseite", fr: "Accueil", it: "Home" },
  contact: { en: "Contact", de: "Kontakt", fr: "Contact", it: "Contatto" },
  search: { en: "Search", de: "Suche", fr: "Recherche", it: "Ricerca" },
  imprint: { en: "Imprint", de: "Impressum", fr: "Mentions légales", it: "Colophon" },
  privacy: { en: "Privacy policy", de: "Datenschutzerklärung", fr: "Protection des données", it: "Protezione dei dati" },
  system: { en: "System", de: "System", fr: "Système", it: "Sistema" },
  layout: { en: "Layout", de: "Layout", fr: "Mise en page", it: "Layout" },
  password: { en: "Forgot password", de: "Passwort vergessen", fr: "Mot de passe oublié", it: "Password dimenticata" },
  login: { en: "Login", de: "Anmelden", fr: "Connexion", it: "Accedi" },
  noAccess: { en: "No access", de: "Kein Zugriff", fr: "Accès refusé", it: "Nessun accesso" },
  notFound: { en: "Not found", de: "Nicht gefunden", fr: "Page introuvable", it: "Non trovato" },
  trash: { en: "Trash", de: "Papierkorb", fr: "Corbeille", it: "Cestino" },
  firstSteps: { en: "First steps", de: "Erste Schritte", fr: "Premiers pas", it: "Primi passi" },
};

const welcome = (login: Node) => ({
  en: `<h1>Welcome</h1>
<p>This is your new website. ${link(login, "Sign in")}, switch on editing with the switch at the top right (or the key E) and click any text to change it — this one too.</p>
<p>Once signed in, the menu shows the page <i>First steps</i>: what is left to do before the site goes public.</p>`,
  de: `<h1>Willkommen</h1>
<p>Das ist Ihre neue Website. ${link(login, "Melden Sie sich an")}, schalten Sie oben rechts mit dem Schalter (oder der Taste E) das Bearbeiten ein und klicken Sie auf einen Text, um ihn zu ändern — auch auf diesen.</p>
<p>Angemeldet zeigt das Menü die Seite <i>Erste Schritte</i>: was noch zu tun ist, bevor die Website öffentlich wird.</p>`,
  fr: `<h1>Bienvenue</h1>
<p>Voici votre nouveau site. ${link(login, "Connectez-vous")}, activez l'édition avec l'interrupteur en haut à droite (ou la touche E) et cliquez sur un texte pour le modifier — celui-ci aussi.</p>
<p>Une fois connecté, le menu affiche la page <i>Premiers pas</i> : ce qu'il reste à faire avant de rendre le site public.</p>`,
  it: `<h1>Benvenuti</h1>
<p>Questo è il vostro nuovo sito. ${link(login, "Accedete")}, attivate la modifica con l'interruttore in alto a destra (o il tasto E) e cliccate su un testo per modificarlo — anche su questo.</p>
<p>Dopo l'accesso, il menu mostra la pagina <i>Primi passi</i>: cosa resta da fare prima che il sito diventi pubblico.</p>`,
});

const IMPRINT = {
  en: `<h1>Imprint</h1>
<p>[Company name]<br>[Street and number]<br>[Postcode and city]<br>[Country]</p>
<p>Email: [address]<br>Phone: [number]</p>
<p>Represented by: [name]<br>Commercial register: [register and number]<br>VAT number: [number]</p>`,
  de: `<h1>Impressum</h1>
<p>[Firmenname]<br>[Strasse und Nummer]<br>[PLZ und Ort]<br>[Land]</p>
<p>E-Mail: [Adresse]<br>Telefon: [Nummer]</p>
<p>Vertreten durch: [Name]<br>Handelsregister: [Register und Nummer]<br>MWST-Nummer: [Nummer]</p>`,
  fr: `<h1>Mentions légales</h1>
<p>[Raison sociale]<br>[Rue et numéro]<br>[NPA et localité]<br>[Pays]</p>
<p>E-mail : [adresse]<br>Téléphone : [numéro]</p>
<p>Représentée par : [nom]<br>Registre du commerce : [registre et numéro]<br>Numéro TVA : [numéro]</p>`,
  it: `<h1>Colophon</h1>
<p>[Ragione sociale]<br>[Via e numero]<br>[NPA e località]<br>[Paese]</p>
<p>E-mail: [indirizzo]<br>Telefono: [numero]</p>
<p>Rappresentata da: [nome]<br>Registro di commercio: [registro e numero]<br>Numero IVA: [numero]</p>`,
};

const PRIVACY = {
  en: `<h1>Privacy policy</h1>
<p><i>A starting point, not legal advice: adapt it to what your site really does.</i></p>
<h2>Who is responsible</h2>
<p>[Company name, address, email]</p>
<h2>What we collect</h2>
<p>When you visit this site, the server records technical data such as your IP address, the time and the page requested, to keep the site running and secure. Messages you send through the contact form are stored and used only to answer you.</p>
<h2>Cookies</h2>
<p>This site uses a cookie to keep you signed in. It does not use tracking cookies.</p>
<h2>Your rights</h2>
<p>You may ask what we store about you, and have it corrected or deleted. Write to [email].</p>`,
  de: `<h1>Datenschutzerklärung</h1>
<p><i>Eine Vorlage, keine Rechtsberatung: Passen Sie sie an das an, was Ihre Website tatsächlich tut.</i></p>
<h2>Verantwortlich</h2>
<p>[Firmenname, Adresse, E-Mail]</p>
<h2>Was wir erheben</h2>
<p>Beim Besuch dieser Website speichert der Server technische Daten wie Ihre IP-Adresse, die Uhrzeit und die aufgerufene Seite, um den Betrieb und die Sicherheit zu gewährleisten. Nachrichten aus dem Kontaktformular werden gespeichert und nur zur Beantwortung verwendet.</p>
<h2>Cookies</h2>
<p>Diese Website verwendet ein Cookie, um Sie angemeldet zu halten. Tracking-Cookies werden nicht verwendet.</p>
<h2>Ihre Rechte</h2>
<p>Sie können Auskunft darüber verlangen, was wir über Sie speichern, und es berichtigen oder löschen lassen. Schreiben Sie an [E-Mail].</p>`,
  fr: `<h1>Protection des données</h1>
<p><i>Un modèle, pas un conseil juridique : adaptez-le à ce que votre site fait réellement.</i></p>
<h2>Responsable</h2>
<p>[Raison sociale, adresse, e-mail]</p>
<h2>Ce que nous collectons</h2>
<p>Lors de votre visite, le serveur enregistre des données techniques comme votre adresse IP, l'heure et la page consultée, afin d'assurer le fonctionnement et la sécurité du site. Les messages envoyés via le formulaire de contact sont conservés et servent uniquement à vous répondre.</p>
<h2>Cookies</h2>
<p>Ce site utilise un cookie pour vous garder connecté. Il n'utilise pas de cookies de suivi.</p>
<h2>Vos droits</h2>
<p>Vous pouvez demander ce que nous conservons à votre sujet, et le faire corriger ou supprimer. Écrivez à [e-mail].</p>`,
  it: `<h1>Protezione dei dati</h1>
<p><i>Un modello, non una consulenza legale: adattatelo a ciò che il vostro sito fa davvero.</i></p>
<h2>Responsabile</h2>
<p>[Ragione sociale, indirizzo, e-mail]</p>
<h2>Cosa raccogliamo</h2>
<p>Durante la visita il server registra dati tecnici come l'indirizzo IP, l'ora e la pagina richiesta, per garantire il funzionamento e la sicurezza del sito. I messaggi inviati tramite il modulo di contatto vengono conservati e usati solo per rispondervi.</p>
<h2>Cookie</h2>
<p>Questo sito usa un cookie per mantenervi connessi. Non usa cookie di tracciamento.</p>
<h2>I vostri diritti</h2>
<p>Potete chiedere cosa conserviamo su di voi e farlo correggere o cancellare. Scrivete a [e-mail].</p>`,
};
