// Modules renamed in qino that read the same data. Verified pairs only — a wrong entry rewrites
// content nodes. If the data differs, the old module belongs in cms-legacy instead.
//
// Deliberately absent, check before adding: cms.filebrowser.pixabay is a different provider than
// cms.filebrowser.pexels.
export const renamedModules: Record<string, string> = {
  "cms.frontend.1": "cms.frontend",
  "cms.cont.notFound1": "cms.cont.not_found", // both render the "main" text
  "cms.cont.notFound": "cms.cont.not_found", // older spelling, same public purpose
  "cms.cont.lang.choose1": "cms.cont.lang.choose", // no content, unknown settings fall back
  "cms.cont.phpfile": "cms.cont.ts", // per-node code — the file itself still needs porting
  "cms.cont.table1": "cms.cont.table", // same texts and settings; migrateTable1 pins the width unit
  "cms.cont.table2": "cms.cont.table", // same module, renamed in qino
  "cms.cont.form1": "cms.cont.form", // migrateForm1 also reshapes its children and settings
  "cms.cont.form1.fields2": "cms.cont.form.fields",
  "cms.cont.text.cd": "cms.cont.text",
  "cms.cont.search1": "cms.cont.search",
  "cms.cont.nav3": "cms.cont.nav", // same setting names
  "cms.cont.login2": "cms.cont.login.password",
  "cms.cont.login3": "cms.cont.login.password",
  "cms.cont.login4": "cms.cont.login.password",
  "cms.cont.youtubevideo": "cms.cont.video.youtube2",
  "cms.backendLayout": "cms.layout.backend",
  "cms.cont.shp3.order.cart3": "cms.cont.shp3.order.cart1",
  "cms.backend.struct": "cms.backend.cms.tree",
  "cms.backend.struct.grpaccess": "cms.backend.cms.tree.access",
  "cms.backend.mails": "cms.backend.mail",
  "cms.backend.superuser.db-clean": "cms.backend.superuser.db.cleanup",
  "cms.backend.superuser.vers": "cms.backend.superuser.versions",
  "cms.backend.superuser.dbfile_clean": "cms.backend.superuser.dbfiles",
};

/** The name a node ends up with after the migration. */
export const currentModule = (name: string): string => renamedModules[name] ?? name;
