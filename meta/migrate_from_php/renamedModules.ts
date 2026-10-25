// Modules renamed in qino that read the same data. Verified pairs only — a wrong entry rewrites
// content nodes. If the data differs, the old module belongs in cms-legacy instead.
//
// Deliberately absent, check before adding: cms.filebrowser.pixabay is a different provider than
// cms.filebrowser.pexels.
export const renamedModules: Record<string, string> = {
  "cms.frontend.1": "cms.frontend",
  "cms.cont.notFound1": "cms.cont.not_found", // both render the "main" text
  "cms.cont.notFound": "cms.cont.not_found", // older spelling, same public purpose
  "cms.cont.not_found1": "cms.cont.not_found", // renders the "main" text too
  "cms.layout.login": "cms.layout.system",
  "cms.cont.lang.choose1": "cms.cont.lang.choose", // no content, unknown settings fall back
  "cms.cont.phpfile": "cms.cont.ts", // per-node code — the file itself still needs porting
  "cms.cont.phpfile1": "cms.cont.ts", // same, one folder per node
  "cms.cont.table1": "cms.cont.table", // same texts and settings; migrateTable1 pins the width unit
  "cms.cont.table2": "cms.cont.table", // migrateTable1 renames the widths
  "cms.cont.form1": "cms.cont.form", // migrateForm1 also reshapes its children and settings
  "cms.cont.form1.fields2": "cms.cont.form.fields",
  "cms.cont.text.cd": "cms.cont.text",
  "cms.cont.search1": "cms.cont.search",
  "cms.cont.nav3": "cms.cont.nav", // same setting names
  "cms.cont.login2": "cms.cont.login.password",
  "cms.cont.login3": "cms.cont.login.password",
  "cms.cont.login4": "cms.cont.login.password",
  "cms.cont.login6": "cms.cont.login.password", // lost pw page, placeholder, logout_redirect fall back
  "cms.cont.youtubevideo": "cms.cont.video.youtube2",
  "cms.backendLayout": "cms.layout.backend",
  "cms.cont.shp3.order.cart3": "cms.cont.shp3.order.cart1",
  "cms.backend.struct": "cms.backend.cms.tree",
  "cms.backend.struct.grpaccess": "cms.backend.cms.tree.access",
  "cms.backend.mails": "cms.backend.superuser.messaging", // the sent mails; messaging keeps them now
  "cms.backend.app1": "cms.backend.config.webapp", // icon and web app data, now in identity
  "cms.backend.module": "cms.backend.cms.module",
  "cms.backend.superuser.log": "cms.backend.superuser.requests.log",
  "cms.backend.superuser.client1": "cms.backend.superuser.requests.clients",
  "cms.backend.db": "cms.backend.superuser.db", // browsing the tables
  "cms.backend.superuser.performance": "cms.backend.system", // cache and runtime
  "cms.backend.superuser.db-clean": "cms.backend.superuser.db.cleanup",
  "cms.backend.superuser.vers": "cms.backend.superuser.versions",
  "cms.backend.superuser.dbfile_clean": "cms.backend.superuser.dbfiles",
};

/** The name a node ends up with after the migration. */
export const currentModule = (name: string): string => renamedModules[name] ?? name;
