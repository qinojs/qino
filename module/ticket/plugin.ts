import dbSchema from "./dbschema.json" with { type: "json" };
import { unixTime } from "@qino/qino";
import type { Jobs } from "@qino/qino/cron";

export { dbSchema };

const YEAR = 365 * 24 * 60 * 60;

// Spent and expired tickets stay as a record of what was handed out; only age removes them.
// Never-expiring ones (an unsubscribe link) are only swept once they have been spent.
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
