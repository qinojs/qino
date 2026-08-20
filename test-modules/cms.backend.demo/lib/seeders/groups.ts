import type { Seed } from "../seed.ts";

// name, cms access level (0 none · 1 read · 2 edit · 3 admin), kind
const GROUPS: [string, number, string][] = [
  ["Demo editors", 2, "team"],
  ["Demo authors", 1, "team"],
  ["Demo reviewers", 1, "team"],
  ["Demo members", 0, "audience"],
  ["Demo newsletter", 0, "audience"],
  ["Demo partners", 0, "audience"],
  ["Demo support", 1, "team"],
  ["Demo beta testers", 0, "audience"],
];

export async function run(s: Seed): Promise<void> {
  const cmsAccess = !!s.db.table("grp").field("cms_access");
  for (const [name, access, type] of GROUPS) {
    const id = await s.db.table("grp").insert({ name, type, ...(cmsAccess ? { cms_access: access } : {}) });
    if (id) s.grps.set(name, Number(id));
    s.count("groups");
  }
}
