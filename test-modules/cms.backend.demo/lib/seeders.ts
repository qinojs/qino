// The registry. `needs` names tables: a seeder whose module is not installed simply does not run,
// so the same demo module fits a bare cms and a full installation.
import * as groups from "./seeders/groups.ts";
import * as users from "./seeders/users.ts";
import * as pages from "./seeders/pages.ts";
import * as traffic from "./seeders/traffic.ts";
import * as mail from "./seeders/mail.ts";
import * as links from "./seeders/links.ts";
import * as errors from "./seeders/errors.ts";

import type { Seed } from "./seed.ts";

export type Seeder = { name: string; title: string; needs?: string[]; run: (s: Seed) => Promise<void> };

export const seeders: Seeder[] = [
  { name: "groups", title: "Groups", needs: ["grp"], run: groups.run },
  { name: "users", title: "Users and memberships", needs: ["usr", "usr_grp"], run: users.run },
  { name: "pages", title: "Pages, contents, texts and images", needs: ["page"], run: pages.run },
  { name: "traffic", title: "Visits and rankings", needs: ["log"], run: traffic.run },
  { name: "mail", title: "Sent mail", needs: ["mail", "mail_recipient"], run: mail.run },
  { name: "links", title: "Short links", needs: ["shorturl"], run: links.run },
  { name: "errors", title: "Error reports", needs: ["m_error_report"], run: errors.run },
];
