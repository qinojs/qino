import { unixTime } from "@qino/qino";

import type { Jobs } from "@qino/qino/cron";

export { default as dbSchema } from "./dbschema.json" with { type: "json" };

const YEAR = 365 * 24 * 60 * 60;

// Used and expired tickets stay as a record; only age removes them. Tickets without expiry are
// only removed once used.
export const cron = {
  old: {
    every: "week",
    jitter: 12 * 60 * 60,
    run: (app) => {
      const now = unixTime();
      return app.db.exec`DELETE FROM ticket
        WHERE created < ${now - YEAR} AND (used >= uses OR expires < ${now})`;
    },
  },
} satisfies Jobs;
