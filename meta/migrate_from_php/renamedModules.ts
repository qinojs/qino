// Modules whose qino successor carries a different name *and* reads the same data. Verified pairs
// only: a wrong entry here silently rewrites content nodes. Where a successor stores things
// differently the old name stays and belongs in the cms-legacy store.
//
// Deliberately absent, check before adding: cms.filebrowser.pixabay is a different provider than
// cms.filebrowser.pexels.
export const renamedModules: Record<string, string> = {
  "cms.frontend.1": "cms.frontend.2",
  "cms.cont.notFound1": "cms.cont.not_found1", // both render the "main" text
  "cms.cont.notFound": "cms.cont.not_found1", // older spelling, same public purpose
  "cms.cont.lang.choose1": "cms.cont.lang.choose2", // no content, unknown settings fall back
  "cms.cont.phpfile": "cms.cont.ts", // per-node code — the file itself still needs porting
  "cms.cont.table1": "cms.cont.table2", // same texts and settings; migrateTable1 pins the width unit
  "cms.cont.table": "cms.cont.table2", // predecessor of table1 with the same cell texts/settings
  "cms.cont.form1": "cms.cont.form2", // migrateForm1 also reshapes its children and settings
  "cms.cont.form1.fields2": "cms.cont.form2.fields1",
  "cms.cont.text.cd": "cms.cont.text",
  "cms.cont.search": "cms.cont.search1",
  "cms.cont.login2": "cms.cont.login4",
  "cms.cont.login3": "cms.cont.login4",
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
