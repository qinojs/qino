import { pwHash } from "@qino/qino";
import { cms } from "@qino/qino/cms";

import manifest from "./manifest.json" with { type: "json" };

import type { App } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

const { name } = manifest;

export const settingsSchema = {
  properties: {
    seeded: {
      type: "string",
      description: "Recommended modules already offered, comma separated. Remove a name to install it again.",
    },
  },
};

// Installed in this order; afterwards each can be uninstalled, and more added from the store.
export const recommended = [
  "fileEditor",
  "identity",
  "webapp",
  "cms.frontend.4",
  "cms.text",
  "cms.image2",
  "cms.filebrowser",
  "cms.cont.text",
  "cms.cont.flexible",
  "cms.cont.nav3",
  "cms.cont.table2",
  "cms.cont.login4",
  "cms.cont.search1",
  "cms.cont.trash",
  "cms.cont.not_found1",
  "cms.layout.custom.9",
  "cms.layout.backend",
  "cms.layout.system",
  "cms.backend",
  "cms.backend.cms",
  "cms.backend.cms.tree",
  "cms.backend.settings",
  "cms.backend.config",
  "cms.backend.config.identity",
  "cms.backend.config.webapp",
  "cms.backend.users",
  "cms.backend.system",
  "cms.backend.superuser",
  "cms.backend.superuser.module",
];

// Once per name, not per app — otherwise an older installation would lack the set and its backend.
export async function init(app: App): Promise<void> {
  const setting = app.settings[name].seeded;
  const seeded = String(await setting ?? "").split(",").filter(Boolean);
  const todo = recommended.filter((mod) => !seeded.includes(mod));
  if (!todo.length) return;

  const store = await app.stores.install(new URL("../store.json", import.meta.url));
  for (const mod of todo) {
    const done = await app.modules.install(store.moduleUrl(mod), mod)
      .catch((e) => void console.error(`[qino] recommended module "${mod}" was skipped:`, e.message ?? e));
    if (done) seeded.push(mod);
  }
  await setting(seeded.join(","));
}

/* Titles in the four backend languages, where the page has none yet. A title only exists in the written
   languages; without the site's language the page shows up nameless in the tree. */
async function titles(page: Node, texts: Record<string, string>) {
  for (const [lang, text] of Object.entries(texts)) if (!await page.title(lang)) await page.title(lang, text);
}

/** The child page of that name with its titles, created when missing. */
async function page(parent: Node, name: string, fields: Record<string, unknown>, texts: Record<string, string>) {
  const node = await parent.child(name, fields);
  await titles(node, texts);
  return node;
}

/** A redirect, unless the site has one for that request already. */
async function redirect(app: App, request: string, page: Node) {
  if (!await app.db.one`SELECT 1 FROM page_redirect WHERE request = ${request}`) {
    await app.db.table("page_redirect").insert({ request, redirect: String(page.id) });
  }
}

// Atomic: a half-installed site can't be repaired on the next boot, since every step skips the
// pages already there.
export function install({ app }: { app: App }): Promise<void> {
  return app.db.transaction(() => installTx(app));
}

async function installTx(app: App) {
  const db = app.db;
  const settings = app.settings;
  const cm = cms(app);

  if (!await settings.core.langs) settings.core.langs('en');

  if (!await db.one`SELECT id FROM usr WHERE active AND NOT superuser`) {
    const adminGrp = await db.table('grp').insert({ name: 'admin', cms_access: 3 });
    const usr = await db.table('usr').insert({ username: 'admin', pw: '', active: true, given_name: 'Client', family_name: 'Client' });
    await db.table('usr_grp').insert({ usr_id: usr, grp_id: adminGrp });

    await (await cm.node(1)).changeGroup(Number(adminGrp), 2);
  }
  // Superuser
  if (!await db.one`SELECT id FROM usr WHERE superuser = ${true}`) {
    // no lookalikes (0/O, 1/l/I), and only symbols that are safe in a shell (no ! # $ % & ? * ~)
    const PW_CHARS = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789-_.+=@";
    const suPw = Array.from(crypto.getRandomValues(new Uint8Array(14)), b => PW_CHARS[b % PW_CHARS.length]).join("");
    await db.table('usr').insert({ username: 'su', pw: await pwHash(suPw), superuser: true, active: true, given_name: 'Superuser', family_name: 'Superuser' });
    // the color code ends before the password, so copying it doesn't include escape sequences
    console.log(`\n\x1b[33m[qino] Superuser created — email: su  password:\x1b[0m ${suPw}\n`);
  }

  const adminGrp = Number(await db.one`SELECT id FROM grp WHERE name = 'admin'`);

  const root = await cm.node(1);
  const home = await page(root, "home", { access: 1, visible: true, searchable: true, sort: 1 },
    { en: "Home", de: "Startseite", fr: "Accueil", it: "Home" });
  await home.changeGroup(adminGrp, 2);
  await redirect(app, "", home);

  const service = await page(root, "service", { access: 1, visible: false, searchable: true, sort: 4 },
    { en: "Service", de: "Service", fr: "Service", it: "Servizio" });
  await service.changeGroup(adminGrp, 1);
  const search = await page(service, "search", { visible: true, searchable: false },
    { en: "Search", de: "Suche", fr: "Recherche", it: "Ricerca" });
  await search.changeGroup(adminGrp, 2);
  await (await search.cont("main")).cont("1", "cms.cont.search1");

  const system = await page(root, "system", { access: 0, visible: false, searchable: false, sort: 8 },
    { en: "System", de: "System", fr: "Système", it: "Sistema" });
  await system.changeGroup(adminGrp, 1);
  const layout = await page(system, "layout", { access: 1, visible: false },
    { en: "Layout", de: "Layout", fr: "Mise en page", it: "Layout" });
  await layout.changeGroup(adminGrp, 1);

  const trash = await page(system, "trash", { access: 0, visible: false, module: "cms.layout.system" },
    { en: "Trash", de: "Papierkorb", fr: "Corbeille", it: "Cestino" });
  await trash.changeGroup(adminGrp, 1);
  await trash.cont("main", "cms.cont.trash");
  if (!await settings.cms.pageTrash) await settings.cms.pageTrash(trash.id);

  const noAccess = await page(system, "no-access", { access: 1, visible: false },
    { en: "No access", de: "Kein Zugriff", fr: "Accès refusé", it: "Nessun accesso" });
  await noAccess.changeGroup(adminGrp, 1);
  await (await noAccess.cont("main")).cont("1", "cms.cont.login4");
  if (!await settings.cms.pageNoAccess) await settings.cms.pageNoAccess(noAccess.id);
  if (!await settings.cms.pageOffline) await settings.cms.pageOffline(noAccess.id);

  const login = await page(system, "login", { access: 1, module: "cms.layout.system" },
    { en: "Login", de: "Anmelden", fr: "Connexion", it: "Accedi" });
  await login.changeGroup(adminGrp, 1);
  await (await login.cont("main")).cont("1", "cms.cont.login4");
  await redirect(app, "login", login);

  const notFound = await page(system, "not-found", { access: 1, visible: false },
    { en: "Not found", de: "Nicht gefunden", fr: "Page introuvable", it: "Non trovato" });
  await notFound.changeGroup(adminGrp, 2);
  await (await notFound.cont("main")).cont("1", "cms.cont.not_found1");
  if (!await settings.cms.pageNotFound) await settings.cms.pageNotFound(notFound.id);

  // define the frontend-module
  if (!await settings.cms.frontend) settings.cms.frontend("cms.frontend.4");

}
