import { renderSections, sectionSettings } from "@qino/qino/cms.cont.imprint";

// Starting texts covering the Swiss FADP (Art. 19) and the GDPR (Art. 13) for what a Qino site does
// out of the box. Sections for features a site may add start switched off.
const SECTIONS = [
  {
    name: "intro", description: "Heading and what the policy covers.",
    initial: {
      en: "<h1>Privacy policy</h1>\n<p>This policy explains which personal data we process when you use this website, for what purpose, and what rights you have. It is based on the Swiss Federal Act on Data Protection (FADP) and, where it applies, the EU General Data Protection Regulation (GDPR).</p>",
      de: "<h1>Datenschutzerklärung</h1>\n<p>Diese Erklärung beschreibt, welche Personendaten wir bei der Nutzung dieser Website bearbeiten, zu welchem Zweck und welche Rechte Sie haben. Sie stützt sich auf das Schweizer Datenschutzgesetz (DSG) und, soweit anwendbar, auf die Datenschutz-Grundverordnung der EU (DSGVO).</p>",
      fr: "<h1>Protection des données</h1>\n<p>La présente déclaration explique quelles données personnelles nous traitons lorsque vous utilisez ce site, dans quel but et quels sont vos droits. Elle se fonde sur la loi fédérale suisse sur la protection des données (LPD) et, lorsqu'il s'applique, sur le règlement général sur la protection des données de l'UE (RGPD).</p>",
      it: "<h1>Protezione dei dati</h1>\n<p>La presente dichiarazione spiega quali dati personali trattiamo quando utilizzate questo sito, per quale scopo e quali diritti avete. Si basa sulla legge federale svizzera sulla protezione dei dati (LPD) e, ove applicabile, sul regolamento generale sulla protezione dei dati dell'UE (RGPD).</p>",
    },
  },
  {
    name: "controller", owner: true, description: "Who is responsible, with name and address from the identity.",
    initial: {
      en: "<h2>Controller</h2>\n<p>Responsible for processing your data is:</p>",
      de: "<h2>Verantwortliche Stelle</h2>\n<p>Verantwortlich für die Bearbeitung Ihrer Daten ist:</p>",
      fr: "<h2>Responsable du traitement</h2>\n<p>Le responsable du traitement de vos données est :</p>",
      it: "<h2>Titolare del trattamento</h2>\n<p>Il titolare del trattamento dei vostri dati è:</p>",
    },
  },
  {
    name: "visit", description: "Server logs when pages are requested.",
    initial: {
      en: "<h2>Visiting this website</h2>\n<p>With every request, our server records technical data: IP address, date and time, the address requested, the referring page, browser and operating system, and for forms the data sent, with passwords and similar secrets masked. We use it to deliver the website, keep it secure and fix errors, and keep it only as long as these purposes require.</p>",
      de: "<h2>Besuch der Website</h2>\n<p>Bei jedem Aufruf speichert unser Server technische Daten: IP-Adresse, Datum und Uhrzeit, die aufgerufene Adresse, die verweisende Seite, Browser und Betriebssystem sowie bei Formularen die gesendeten Daten, wobei Passwörter und ähnliche Geheimnisse unkenntlich gemacht werden. Wir verwenden sie, um die Website auszuliefern, sie zu schützen und Fehler zu beheben, und bewahren sie nur so lange auf, wie es diese Zwecke erfordern.</p>",
      fr: "<h2>Visite du site</h2>\n<p>À chaque requête, notre serveur enregistre des données techniques : adresse IP, date et heure, adresse demandée, page de provenance, navigateur et système d'exploitation et, pour les formulaires, les données envoyées, les mots de passe et secrets similaires étant masqués. Nous les utilisons pour fournir le site, le protéger et corriger des erreurs, et ne les conservons que le temps nécessaire à ces fins.</p>",
      it: "<h2>Visita del sito</h2>\n<p>A ogni richiesta il nostro server registra dati tecnici: indirizzo IP, data e ora, indirizzo richiesto, pagina di provenienza, browser e sistema operativo e, per i moduli, i dati inviati, con password e segreti simili mascherati. Li usiamo per fornire il sito, proteggerlo e correggere errori, e li conserviamo solo per il tempo necessario a tali scopi.</p>",
    },
  },
  {
    name: "cookies", description: "Cookies of the site itself: browser recognition and sign-in.",
    initial: {
      en: "<h2>Cookies</h2>\n<p>We set a cookie that recognises your browser for up to five years. It links your visits in our server logs, which helps us detect misuse, and lets the sign-in offer accounts already used on this device. Further cookies keep you signed in. We do not use cookies for advertising and do not pass them on to third parties. You can block or delete cookies in your browser; some functions may then no longer work.</p>",
      de: "<h2>Cookies</h2>\n<p>Wir setzen ein Cookie, das Ihren Browser bis zu fünf Jahre wiedererkennt. Es verknüpft Ihre Besuche in unseren Server-Protokollen, was uns hilft, Missbrauch zu erkennen, und lässt die Anmeldung Konten anbieten, die auf diesem Gerät bereits verwendet wurden. Weitere Cookies halten Sie angemeldet. Für Werbung verwenden wir keine Cookies, und wir geben sie nicht an Dritte weiter. Sie können Cookies in Ihrem Browser sperren oder löschen; einzelne Funktionen stehen dann möglicherweise nicht mehr zur Verfügung.</p>",
      fr: "<h2>Cookies</h2>\n<p>Nous déposons un cookie qui reconnaît votre navigateur pendant cinq ans au plus. Il relie vos visites dans nos journaux de serveur, ce qui nous aide à détecter les abus, et permet à la connexion de proposer les comptes déjà utilisés sur cet appareil. D'autres cookies vous gardent connecté. Nous n'utilisons pas de cookies à des fins publicitaires et ne les transmettons pas à des tiers. Vous pouvez bloquer ou supprimer les cookies dans votre navigateur ; certaines fonctions risquent alors de ne plus être disponibles.</p>",
      it: "<h2>Cookie</h2>\n<p>Impostiamo un cookie che riconosce il vostro browser per un massimo di cinque anni. Collega le vostre visite nei nostri log del server, il che ci aiuta a individuare abusi, e consente all'accesso di proporre gli account già usati su questo dispositivo. Altri cookie vi mantengono connessi. Non usiamo cookie a scopo pubblicitario e non li trasmettiamo a terzi. Potete bloccare o cancellare i cookie nel vostro browser; alcune funzioni potrebbero allora non essere più disponibili.</p>",
    },
  },
  {
    name: "contact", description: "Contact form and email.",
    initial: {
      en: "<h2>Contact form and email</h2>\n<p>If you contact us through the form or by email, we process the information you provide, such as your name, email address and message, to handle your request. We keep it as long as this requires and the law obliges us to.</p>",
      de: "<h2>Kontaktformular und E-Mail</h2>\n<p>Wenn Sie uns über das Formular oder per E-Mail kontaktieren, bearbeiten wir Ihre Angaben wie Name, E-Mail-Adresse und Nachricht, um Ihr Anliegen zu beantworten. Wir bewahren sie auf, solange dies dafür nötig ist und das Gesetz es verlangt.</p>",
      fr: "<h2>Formulaire de contact et e-mail</h2>\n<p>Si vous nous contactez via le formulaire ou par e-mail, nous traitons les informations fournies, telles que votre nom, votre adresse e-mail et votre message, afin de répondre à votre demande. Nous les conservons aussi longtemps que nécessaire à cette fin et que la loi l'exige.</p>",
      it: "<h2>Modulo di contatto ed e-mail</h2>\n<p>Se ci contattate tramite il modulo o per e-mail, trattiamo i dati forniti, come nome, indirizzo e-mail e messaggio, per rispondere alla vostra richiesta. Li conserviamo per il tempo necessario a tale scopo e richiesto dalla legge.</p>",
    },
  },
  {
    name: "account", on: false, description: "User accounts.",
    initial: {
      en: "<h2>User account</h2>\n<p>If you create an account, we store the details you provide, such as your name and email address, and your password in protected form, for as long as the account exists. You can ask us to delete your account at any time.</p>",
      de: "<h2>Benutzerkonto</h2>\n<p>Wenn Sie ein Konto eröffnen, speichern wir Ihre Angaben wie Name und E-Mail-Adresse sowie Ihr Passwort in geschützter Form, solange das Konto besteht. Sie können jederzeit verlangen, dass wir Ihr Konto löschen.</p>",
      fr: "<h2>Compte utilisateur</h2>\n<p>Si vous créez un compte, nous enregistrons les informations fournies, comme votre nom et votre adresse e-mail, ainsi que votre mot de passe sous forme protégée, aussi longtemps que le compte existe. Vous pouvez à tout moment nous demander de supprimer votre compte.</p>",
      it: "<h2>Account utente</h2>\n<p>Se create un account, conserviamo i dati forniti, come nome e indirizzo e-mail, e la vostra password in forma protetta, finché l'account esiste. Potete chiederci in qualsiasi momento di cancellare il vostro account.</p>",
    },
  },
  {
    name: "providers", description: "Hosting, content delivery and transfers abroad.",
    initial: {
      en: "<h2>Hosting and service providers</h2>\n<p>This website runs at a hosting provider that processes data on our behalf and only on our instructions. Parts of it, such as scripts or fonts, may be delivered by a content delivery network, which then receives your IP address. If personal data goes to a country without adequate data protection, we ensure suitable safeguards, such as standard contractual clauses.</p>",
      de: "<h2>Hosting und Dienstleister</h2>\n<p>Diese Website läuft bei einem Hosting-Anbieter, der Daten in unserem Auftrag und nur nach unseren Weisungen bearbeitet. Teile davon, etwa Skripte oder Schriften, kann ein Content-Delivery-Netzwerk ausliefern, das dabei Ihre IP-Adresse erhält. Gelangen Personendaten in ein Land ohne angemessenen Datenschutz, sorgen wir für geeignete Garantien, etwa Standardvertragsklauseln.</p>",
      fr: "<h2>Hébergement et prestataires</h2>\n<p>Ce site est exploité chez un hébergeur qui traite des données pour notre compte et uniquement selon nos instructions. Certaines parties, comme des scripts ou des polices, peuvent être fournies par un réseau de diffusion de contenu, qui reçoit alors votre adresse IP. Si des données personnelles sont transmises dans un pays sans protection adéquate, nous prévoyons des garanties appropriées, comme des clauses contractuelles types.</p>",
      it: "<h2>Hosting e fornitori di servizi</h2>\n<p>Questo sito è ospitato da un fornitore di hosting che tratta dati per nostro conto e solo secondo le nostre istruzioni. Alcune parti, come script o font, possono essere fornite da una rete di distribuzione di contenuti, che riceve così il vostro indirizzo IP. Se dati personali vengono trasmessi in un paese senza una protezione adeguata, prevediamo garanzie appropriate, come clausole contrattuali tipo.</p>",
    },
  },
  {
    name: "embeds", on: false, description: "Embedded content of third parties, such as maps or videos.",
    initial: {
      en: "<h2>Embedded content</h2>\n<p>Some pages embed content of third parties, such as maps or videos. When you open such a page, your browser connects to the provider, which receives your IP address and may set cookies. The providers' own privacy policies apply.</p>",
      de: "<h2>Eingebettete Inhalte</h2>\n<p>Einige Seiten binden Inhalte Dritter ein, etwa Karten oder Videos. Öffnen Sie eine solche Seite, verbindet sich Ihr Browser mit dem Anbieter, der dabei Ihre IP-Adresse erhält und Cookies setzen kann. Es gelten die Datenschutzerklärungen der Anbieter.</p>",
      fr: "<h2>Contenus intégrés</h2>\n<p>Certaines pages intègrent des contenus de tiers, comme des cartes ou des vidéos. Lorsque vous ouvrez une telle page, votre navigateur se connecte au fournisseur, qui reçoit votre adresse IP et peut déposer des cookies. Les déclarations de protection des données des fournisseurs s'appliquent.</p>",
      it: "<h2>Contenuti incorporati</h2>\n<p>Alcune pagine incorporano contenuti di terzi, come mappe o video. Quando aprite una di queste pagine, il vostro browser si collega al fornitore, che riceve il vostro indirizzo IP e può impostare cookie. Valgono le dichiarazioni sulla protezione dei dati dei fornitori.</p>",
    },
  },
  {
    name: "bases", description: "Legal bases under the GDPR.",
    initial: {
      en: "<h2>Legal bases</h2>\n<p>Where the GDPR applies, we process your data to perform a contract or take steps towards one (Art. 6(1)(b)), to meet legal obligations (Art. 6(1)(c)), on the basis of our legitimate interest in a secure, working website and in answering enquiries (Art. 6(1)(f)), or with your consent (Art. 6(1)(a)), which you can withdraw at any time with effect for the future.</p>",
      de: "<h2>Rechtsgrundlagen</h2>\n<p>Soweit die DSGVO gilt, bearbeiten wir Ihre Daten zur Erfüllung eines Vertrags oder vorvertraglicher Massnahmen (Art. 6 Abs. 1 lit. b), zur Erfüllung rechtlicher Pflichten (Art. 6 Abs. 1 lit. c), gestützt auf unser berechtigtes Interesse an einer sicheren, funktionierenden Website und an der Beantwortung von Anfragen (Art. 6 Abs. 1 lit. f) oder mit Ihrer Einwilligung (Art. 6 Abs. 1 lit. a), die Sie jederzeit mit Wirkung für die Zukunft widerrufen können.</p>",
      fr: "<h2>Bases juridiques</h2>\n<p>Lorsque le RGPD s'applique, nous traitons vos données pour exécuter un contrat ou des mesures précontractuelles (art. 6, par. 1, let. b), pour respecter des obligations légales (art. 6, par. 1, let. c), sur la base de notre intérêt légitime à un site sûr et fonctionnel et à répondre aux demandes (art. 6, par. 1, let. f), ou avec votre consentement (art. 6, par. 1, let. a), que vous pouvez retirer à tout moment pour l'avenir.</p>",
      it: "<h2>Basi giuridiche</h2>\n<p>Ove si applichi il RGPD, trattiamo i vostri dati per eseguire un contratto o misure precontrattuali (art. 6 par. 1 lett. b), per adempiere obblighi legali (art. 6 par. 1 lett. c), sulla base del nostro legittimo interesse a un sito sicuro e funzionante e a rispondere alle richieste (art. 6 par. 1 lett. f), oppure con il vostro consenso (art. 6 par. 1 lett. a), che potete revocare in qualsiasi momento con effetto per il futuro.</p>",
    },
  },
  {
    name: "rights", description: "Rights of the people concerned and where to complain.",
    initial: {
      en: "<h2>Your rights</h2>\n<p>Within the applicable law, you may request access to your personal data, have it corrected or deleted, restrict or object to its processing, and receive it in a common format. Write to us at the address above. You may also complain to a data protection authority: in Switzerland the Federal Data Protection and Information Commissioner (FDPIC), in the EU the authority of your country of residence.</p>",
      de: "<h2>Ihre Rechte</h2>\n<p>Im Rahmen des anwendbaren Rechts können Sie Auskunft über Ihre Personendaten verlangen, sie berichtigen oder löschen lassen, ihre Bearbeitung einschränken oder ihr widersprechen und sie in einem gängigen Format erhalten. Schreiben Sie uns an die oben genannte Adresse. Zudem können Sie sich bei einer Datenschutzbehörde beschweren: in der Schweiz beim Eidgenössischen Datenschutz- und Öffentlichkeitsbeauftragten (EDÖB), in der EU bei der Behörde Ihres Wohnsitzstaats.</p>",
      fr: "<h2>Vos droits</h2>\n<p>Dans le cadre du droit applicable, vous pouvez demander l'accès à vos données personnelles, les faire rectifier ou effacer, en limiter le traitement ou vous y opposer, et les recevoir dans un format courant. Écrivez-nous à l'adresse ci-dessus. Vous pouvez aussi déposer une plainte auprès d'une autorité de protection des données : en Suisse le Préposé fédéral à la protection des données et à la transparence (PFPDT), dans l'UE l'autorité de votre pays de résidence.</p>",
      it: "<h2>I vostri diritti</h2>\n<p>Nei limiti del diritto applicabile potete chiedere l'accesso ai vostri dati personali, farli rettificare o cancellare, limitarne il trattamento od opporvi, e riceverli in un formato di uso comune. Scriveteci all'indirizzo indicato sopra. Potete inoltre presentare reclamo a un'autorità di protezione dei dati: in Svizzera all'Incaricato federale della protezione dei dati e della trasparenza (IFPDT), nell'UE all'autorità del vostro paese di residenza.</p>",
    },
  },
  {
    name: "changes", description: "Changes to this policy.",
    initial: {
      en: "<h2>Changes</h2>\n<p>We may adapt this privacy policy at any time. The version published here applies.</p>",
      de: "<h2>Änderungen</h2>\n<p>Wir können diese Datenschutzerklärung jederzeit anpassen. Es gilt die hier veröffentlichte Fassung.</p>",
      fr: "<h2>Modifications</h2>\n<p>Nous pouvons adapter la présente déclaration à tout moment. La version publiée ici fait foi.</p>",
      it: "<h2>Modifiche</h2>\n<p>Possiamo adeguare la presente dichiarazione in qualsiasi momento. Fa fede la versione pubblicata qui.</p>",
    },
  },
];

export const cms = {
  node: { css: ["pub/main.css"], render: renderSections(SECTIONS), settingsSchema: sectionSettings(SECTIONS) },
};
