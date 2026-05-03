/**
 * cms.installation.default/mod.ts - Default CMS installation
 * Port of cms.installation.default/install.php
 */

import type { App } from "../core/server.ts";

export const name = "cms.installation.default";
export const needs = [
  "cms",
  "cms.frontend.1",
  "cms.backend",
  "error_report",
  "cms.versions",
  "cms.backend.superuser.error_report",
  "cms.backend.settings",
  "cms.backend.users",
  "cms.backend.struct",
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

export async function install({app}: {app: App}): Promise<void> {
  const s = app.settings;
  let freshInstallation = false;
  if (!await app.settings.qg.langs) {
    app.settings.qg.langs('de');
    freshInstallation = true;
  }

  // Benutzer
  if (!await app.db.one("SELECT id FROM usr WHERE active AND !superuser")) {
    const adminGrp = (await app.db.exec("INSERT INTO grp SET name = 'admin', page_access = '1'")).insertId;
    const usr = (await app.db.exec("INSERT INTO usr SET email = 'admin', pw = '', active=1, firstname='Client', lastname='Client'")).insertId;
    await app.db.query("INSERT INTO usr_grp SET usr_id = ?, grp_id = ?", [usr, adminGrp]);
    await (await app.cms.node(1)).changeGroup(adminGrp, 2);
  }
  // Superuser
  if (!await app.db.one("SELECT id FROM usr WHERE superuser = '1'")) {
    await app.db.query("INSERT INTO usr SET email = 'su', pw = '$2y$10$CfeMgTdPi26our51Q06E4u.Hf/H5p2UFJcDc0uFS/TM6Ar7KLiCL2', superuser=1, active=1, firstname='Superuser', lastname='Superuser'");
  }

  // Admingruppe ID holen (für nachfolgende Seiten)
  const adminGrp = await app.db.one("SELECT id FROM grp WHERE name = 'admin'");

  // Home
  if (!await app.db.one("SELECT id FROM page WHERE id = 2")) {
    const P = await (await app.cms.node(1)).createChild({ id: 2, access: 1, visible: 1, offline: 0, searchable: 1, sort: 1 });
    await P.changeGroup(adminGrp, 2);
    await app.db.query("REPLACE INTO page_redirect SET request = '', redirect = '2'");
    await (await P.title()).set("de", "Home");
    await (await P.title()).set("en", "Home");
  }
  // Service
  if (!await app.db.one("SELECT id FROM page WHERE id = 10")) {
    const P = await (await app.cms.node(1)).createChild({ id: 10, access: 1, visible: 0, searchable: 1, sort: 4 });
    await P.changeGroup(adminGrp, 1);
    await (await P.title()).set("de", "Service");
    await (await P.title()).set("en", "Service");
  }
  // Suche
  if (!await app.db.one("SELECT id FROM page WHERE id = 20")) {
    const P = await (await app.cms.node(10)).createChild({ id: 20, visible: 1, searchable: 0 });
    await P.changeGroup(adminGrp, 2);
    await (await (await P.cont("main")).cont(1, "cms.cont.search1"));
    await (await P.title()).set("de", "Suche");
    await (await P.title()).set("en", "Search");
  }

  // System
  if (!await app.db.one("SELECT id FROM page WHERE id = 40")) {
    const P = await (await app.cms.node(1)).createChild({ id: 40, access: 0, visible: 0, searchable: 0, sort: 8 });
    await P.changeGroup(adminGrp, 1);
    await (await P.title()).set("de", "System");
    await (await P.title()).set("en", "System");
  }
  // Layout
  if (!await app.db.one("SELECT id FROM page WHERE id = 5")) {
    const P = await (await app.cms.node(40)).createChild({ id: 5, access: 1, offline: 0, visible: 0 });
    await P.changeGroup(adminGrp, 1);
    await (await P.title()).set("de", "Layout");
    await (await P.title()).set("en", "Layout");
  }

  // Papierkorb
  if (!await app.db.one("SELECT id FROM page WHERE id = 50")) {
    const P = await (await app.cms.node(40)).createChild({ id: 50, access: 0, offline: 0, visible: 0 });
    await P.changeGroup(adminGrp, 1);
    await (await P.cont("main")).cont("cms.cont.trash");
    await (await P.title()).set("de", "Papierkorb");
    await (await P.title()).set("en", "Trash");
    if (!await s.cms.pageTrash) s.cms.pageTrash(50);
  }
  await (await app.cms.node(50)).set("module", "cms.layout.login");
  await (await (await app.cms.node(50)).cont("main")).set("module", "cms.cont.trash");

  // Kein Recht
  if (!await app.db.one("SELECT id FROM page WHERE id = 60")) {
    const P = await (await app.cms.node(40)).createChild({ id: 60, access: 1, offline: 0, visible: 0 });
    await P.changeGroup(adminGrp, 1);
    await (await P.cont("main")).cont('1', "cms.cont.login4");
    await (await P.title()).set("de", "kein Recht");
    await (await P.title()).set("en", "No access");
    if (!await s.cms.pageNoAccess) s.cms.pageNoAccess(60);
  }
  // Login
  if (!await app.db.one("SELECT id FROM page WHERE id = 80")) {
    const P = await (await app.cms.node(40)).createChild({ id: 80, access: 1, offline: 0 });
    await P.changeGroup(adminGrp, 1);
    await (await P.cont("main")).cont('1', "cms.cont.login4");
    // await (await C.SET).make("redirect", 2); // todo: Cont-Settings API
    await (await P.title()).set("de", "Login");
    await (await P.title()).set("en", "Login");
    await app.db.query("REPLACE INTO page_redirect SET request = 'login', redirect = '80'");
  }
  await (await app.cms.node(80)).set("module", "cms.layout.login");
  await (await (await app.cms.node(80)).cont("main")).cont('1').then((c: any) => c.set("module", "cms.cont.login4"));

  // nicht gefunden und Offline
  if (!await app.db.one("SELECT id FROM page WHERE id = 70")) {
    const P = await (await app.cms.node(40)).createChild({ id: 70, access: 1, offline: 0, visible: 0 });
    await P.changeGroup(adminGrp, 2);
    await (await P.cont("main")).cont('1', "cms.cont.not_found1");
    await (await P.title()).set("de", "nicht gefunden");
    await (await P.title()).set("en", "not Found");
    if (!await s.cms.pageNotFound) s.cms.pageNotFound(70);
    if (!await s.cms.pageOffline)  s.cms.pageOffline(60);
  }

  // Frontend installieren
  if (!await s.cms.frontend) s.cms.frontend("cms.frontend.1");

}
