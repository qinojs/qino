import { sections } from "./lib/sections.ts";

// Starting texts for Switzerland, the EU and beyond: identity and contact (UWG Art. 3 lit. s,
// DDG § 5, ECG § 5), then the usual notices. Sites add blocks, such as credits, below the owner.
const SECTIONS = [
  {
    name: "owner", owner: true, area: true,
    description: "Heading, then name, address, contact and numbers from the identity.",
    initial: {
      en: "<h1>Imprint</h1>",
      de: "<h1>Impressum</h1>",
      fr: "<h1>Mentions légales</h1>",
      it: "<h1>Colophon</h1>",
    },
  },
  {
    name: "register", on: false, description: "Commercial register and who may represent the company.",
    initial: {
      en: "<h2>Commercial register</h2>\n<p>Registered in the commercial register of [register office] under [number].<br>Authorised to represent: [names]</p>",
      de: "<h2>Handelsregister</h2>\n<p>Eingetragen im Handelsregister [Registeramt] unter [Nummer].<br>Vertretungsberechtigt: [Namen]</p>",
      fr: "<h2>Registre du commerce</h2>\n<p>Inscrite au registre du commerce de [office du registre] sous le numéro [numéro].<br>Personnes autorisées à représenter : [noms]</p>",
      it: "<h2>Registro di commercio</h2>\n<p>Iscritta nel registro di commercio di [ufficio del registro] con il numero [numero].<br>Persone autorizzate a rappresentare: [nomi]</p>",
    },
  },
  {
    name: "disclaimer", description: "Liability for the content.",
    initial: {
      en: "<h2>Liability for content</h2>\n<p>We compile the content of this website with care, but cannot guarantee that it is correct, complete and up to date. We accept no liability for damage arising from the use of the information published here, unless it was caused intentionally or through gross negligence. We may change, add to or remove content at any time without notice.</p>",
      de: "<h2>Haftung für Inhalte</h2>\n<p>Wir erstellen die Inhalte dieser Website mit Sorgfalt, können aber nicht garantieren, dass sie richtig, vollständig und aktuell sind. Für Schäden aus der Nutzung der hier veröffentlichten Informationen haften wir nicht, ausser sie wurden vorsätzlich oder grob fahrlässig verursacht. Inhalte können wir jederzeit ohne Ankündigung ändern, ergänzen oder entfernen.</p>",
      fr: "<h2>Responsabilité pour le contenu</h2>\n<p>Nous élaborons le contenu de ce site avec soin, mais ne pouvons garantir qu'il soit exact, complet et à jour. Nous déclinons toute responsabilité pour les dommages résultant de l'utilisation des informations publiées ici, sauf en cas de faute intentionnelle ou de négligence grave. Nous pouvons modifier, compléter ou supprimer des contenus à tout moment et sans préavis.</p>",
      it: "<h2>Responsabilità per i contenuti</h2>\n<p>Curiamo con attenzione i contenuti di questo sito, ma non possiamo garantire che siano corretti, completi e aggiornati. Non rispondiamo di danni derivanti dall'uso delle informazioni qui pubblicate, salvo dolo o colpa grave. Possiamo modificare, integrare o rimuovere contenuti in qualsiasi momento e senza preavviso.</p>",
    },
  },
  {
    name: "links", description: "Liability for links to other websites.",
    initial: {
      en: "<h2>Links</h2>\n<p>This website links to websites of third parties, whose content we do not control. Their operators alone are responsible for it. Should we learn that a linked page breaks the law, we will remove the link.</p>",
      de: "<h2>Links</h2>\n<p>Diese Website verweist auf Websites Dritter, auf deren Inhalte wir keinen Einfluss haben. Für diese sind allein deren Betreiber verantwortlich. Erfahren wir von Rechtsverstössen auf einer verlinkten Seite, entfernen wir den Link.</p>",
      fr: "<h2>Liens</h2>\n<p>Ce site renvoie à des sites de tiers dont nous ne maîtrisons pas le contenu. Seuls leurs exploitants en sont responsables. Si nous apprenons qu'une page liée enfreint la loi, nous supprimons le lien.</p>",
      it: "<h2>Link</h2>\n<p>Questo sito rimanda a siti di terzi, sui cui contenuti non abbiamo alcun controllo. Ne sono responsabili unicamente i loro gestori. Se veniamo a conoscenza di violazioni di legge su una pagina collegata, rimuoviamo il link.</p>",
    },
  },
  {
    name: "copyright", description: "Copyright of texts, images and other content.",
    initial: {
      en: "<h2>Copyright</h2>\n<p>Texts, images and other content on this website are protected by copyright and belong to us or the rights holders named. Any use beyond what the law allows requires prior written consent.</p>",
      de: "<h2>Urheberrecht</h2>\n<p>Texte, Bilder und weitere Inhalte dieser Website sind urheberrechtlich geschützt und gehören uns oder den genannten Rechteinhabern. Jede Verwendung über das gesetzlich Erlaubte hinaus bedarf der vorherigen schriftlichen Zustimmung.</p>",
      fr: "<h2>Droit d'auteur</h2>\n<p>Les textes, images et autres contenus de ce site sont protégés par le droit d'auteur et nous appartiennent ou appartiennent aux ayants droit mentionnés. Toute utilisation au-delà de ce que la loi permet requiert un accord écrit préalable.</p>",
      it: "<h2>Diritto d'autore</h2>\n<p>Testi, immagini e altri contenuti di questo sito sono protetti dal diritto d'autore e appartengono a noi o ai titolari dei diritti indicati. Ogni uso che vada oltre quanto consentito dalla legge richiede il consenso scritto preventivo.</p>",
    },
  },
  {
    name: "dispute", on: false, description: "Consumer dispute resolution (required of many traders in the EU).",
    initial: {
      en: "<h2>Consumer dispute resolution</h2>\n<p>We are neither obliged nor willing to take part in dispute resolution proceedings before a consumer arbitration board.</p>",
      de: "<h2>Verbraucherstreitbeilegung</h2>\n<p>Wir sind nicht verpflichtet und nicht bereit, an Streitbeilegungsverfahren vor einer Verbraucherschlichtungsstelle teilzunehmen.</p>",
      fr: "<h2>Règlement des litiges de consommation</h2>\n<p>Nous ne sommes ni tenus ni disposés à participer à une procédure de règlement des litiges devant un organe de médiation de la consommation.</p>",
      it: "<h2>Risoluzione delle controversie dei consumatori</h2>\n<p>Non siamo obbligati né disposti a partecipare a procedure di risoluzione delle controversie dinanzi a un organismo di conciliazione per i consumatori.</p>",
    },
  },
];

const { render, settingsSchema } = sections(SECTIONS);

export const cms = { node: { css: ["pub/main.css"], render, settingsSchema } };
