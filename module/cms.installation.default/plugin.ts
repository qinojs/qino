import { pwHash, type App } from "../core/mod.ts";
import { cms } from "../cms/mod.ts";

export const name = "cms.installation.default";
export const description = "Installs a ready-to-use default CMS site and administrator accounts.";
export const needs = [
  "cms",
  "cms.frontend.2",
  "cms.backend",
  "error_report",
  //"cms.versions",
  "cms.backend.superuser.error_report",
  "cms.backend.settings",
  "cms.backend.users",
  "cms.backend.cms.tree",
  "cms.cont.flexible",
  "cms.cont.login4",
  "cms.cont.nav3",
  "cms.cont.table2",
  "cms.cont.text",
  "cms.layout.backend",
  "cms.layout.login",
  "cms.layout.custom.9",
  "cms.image2",
  "cms.text",
    // optional: cms.cont.phpfile1
    // optional: cms.cont.not_found1
    // optional: cms.backend.superuser
    // optional: cms.backend.superuser.db
    // optional: cms.backend.superuser.db.query
    // optional: cms.backend.superuser.db-clean
    // optional: cms.backend.superuser.dbfile_clean
    // optional: cms.backend.superuser.vers
    // optional: cms.backend.superuser.log
    // optional: cms.backend.superuser.client1
    // optional: cms.backend.module
    // optional: cms.backend.system
    // optional: cms.backend.mails
    // optional: cms.backend.groups
    // optional: cms.backend.struct.grpaccess
    // optional: cms.backend.webmaster
    // optional: cms.backend.app1
    // optional: cms.cont.search1
    // optional: cms.cont.redirect
    // optional: cms.cont.impressum2
    // optional: cms.encrypt_emails
    // optional: cms.image_editor
    // optional: cms.filebrowser
    // optional: cms.filebrowser.pexels
    // optional: reporting
    // optional: cron1
];

// Atomic: a half-installed site (pages without their trash/login/not-found targets) is unrecoverable
// on the next boot, because every step guards itself with "does this id already exist?".
export function install({app}: {app: App}): Promise<void> {
  return app.db.transaction(() => installTx(app));
}

async function installTx(app: App): Promise<void> {
  const db = app.db;
  const settings = app.settings;
  const cm = cms(app);

  if (!await settings.core.langs) settings.core.langs('en');

  if (!await db.one`SELECT id FROM usr WHERE active AND NOT superuser`) {
    const adminGrp = await db.table('grp').insert({ name: 'admin', cms_access: 3 });
    const usr = await db.table('usr').insert({ email: 'admin', pw: '', active: true, firstname: 'Client', lastname: 'Client' });
    await db.table('usr_grp').insert({ usr_id: usr, grp_id: adminGrp });

    await (await cm.node(1)).changeGroup(Number(adminGrp), 2);
  }
  // Superuser
  if (!await db.one`SELECT id FROM usr WHERE superuser = ${true}`) {
    const pwChars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789!#$%&";
    const suPw = Array.from(crypto.getRandomValues(new Uint8Array(10)), b => pwChars[b % pwChars.length]).join("");
    await db.table('usr').insert({ email: 'su', pw: await pwHash(suPw), superuser: true, active: true, firstname: 'Superuser', lastname: 'Superuser' });
    console.log(`\n\x1b[33m[qino] Superuser created — email: su  password: ${suPw}\x1b[0m\n`);
  }

  const adminGrp = Number(await db.one`SELECT id FROM grp WHERE name = 'admin'`);

  // Home
  if (!await db.one`SELECT id FROM page WHERE id = 2`) {
    const p = await (await cm.node(1)).createChild({ id: 2, access: 1, visible: true, offline: 0, searchable: true, sort: 1 });
    await p.changeGroup(adminGrp, 2);
    await db.table("page_redirect").insert({ request: "", redirect: "2" });
    await p.title("en", "Home");
  }
  // Service
  if (!await db.one`SELECT id FROM page WHERE id = 10`) {
    const p = await (await cm.node(1)).createChild({ id: 10, access: 1, visible: false, searchable: true, sort: 4 });
    await p.changeGroup(adminGrp, 1);
    await p.title("en", "Service");
  }
  if (!await db.one`SELECT id FROM page WHERE id = 20`) {
    const p = await (await cm.node(10)).createChild({ id: 20, visible: true, searchable: false });
    await p.changeGroup(adminGrp, 2);
    await (await p.cont("main")).cont('1', "cms.cont.search1");
    await p.title("en", "Search");
  }

  if (!await db.one`SELECT id FROM page WHERE id = 40`) {
    const p = await (await cm.node(1)).createChild({ id: 40, access: 0, visible: false, searchable: false, sort: 8 });
    await p.changeGroup(adminGrp, 1);
    await p.title("en", "System");
  }
  if (!await db.one`SELECT id FROM page WHERE id = 5`) {
    const p = await (await cm.node(40)).createChild({ id: 5, access: 1, offline: 0, visible: false });
    await p.changeGroup(adminGrp, 1);
    await p.title("en", "Layout");
  }

  if (!await db.one`SELECT id FROM page WHERE id = 50`) {
    const p = await (await cm.node(40)).createChild({ id: 50, access: 0, offline: 0, visible: false });
    await p.changeGroup(adminGrp, 1);
    await (await p.cont("main")).cont("cms.cont.trash");
    await p.title('en', "Trash");
    if (!await settings.cms.pageTrash) settings.cms.pageTrash(50);
  }
  await (await cm.node(50)).set("module", "cms.layout.login");
  await (await (await cm.node(50)).cont("main")).set("module", "cms.cont.trash");

  if (!await db.one`SELECT id FROM page WHERE id = 60`) {
    const p = await (await cm.node(40)).createChild({ id: 60, access: 1, offline: 0, visible: false });
    await p.changeGroup(adminGrp, 1);
    await (await p.cont("main")).cont('1', "cms.cont.login4");
    await p.title("en", "No access");
    if (!await settings.cms.pageNoAccess) settings.cms.pageNoAccess(60);
  }
  if (!await db.one`SELECT id FROM page WHERE id = 80`) {
    const p = await (await cm.node(40)).createChild({ id: 80, access: 1, offline: 0 });
    await p.changeGroup(adminGrp, 1);
    await (await p.cont("main")).cont('1', "cms.cont.login4");
    await p.title("en", "Login");
    await db.table("page_redirect").insert({ request: "login", redirect: "80" });
  }
  await (await cm.node(80)).set("module", "cms.layout.login");
  await (await (await cm.node(80)).cont("main")).cont('1').then((c) => c.set("module", "cms.cont.login4"));

  if (!await db.one`SELECT id FROM page WHERE id = 70`) {
    const p = await (await cm.node(40)).createChild({ id: 70, access: 1, offline: 0, visible: false });
    await p.changeGroup(adminGrp, 2);
    await (await p.cont("main")).cont('1', "cms.cont.not_found1");
    await p.title("en", "Not found");
    if (!await settings.cms.pageNotFound) settings.cms.pageNotFound(70);
    if (!await settings.cms.pageOffline)  settings.cms.pageOffline(60);
  }

  // define the frontend-module
  if (!await settings.cms.frontend) settings.cms.frontend("cms.frontend.2");

}
