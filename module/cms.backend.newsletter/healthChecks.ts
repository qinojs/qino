import { unixTime } from "@qino/qino";

import { draftTemplate } from "./render.ts";
import { CHANNEL, setup, TYPE } from "./setup.ts";

import type { App } from "@qino/qino";

/** Overdue by this much, a scheduled newsletter means the outbox job is not running. */
const LATE = 10 * 60;

export function healthChecks(app: App) {
  return {
    warning: {

      // without `{{unsubscribe}}` nobody can leave; Gmail and Yahoo also require one-click unsubscribe
      "newsletters carry an unsubscribe link": async () => {
        const row = await draftTemplate(app);
        if (row?.text.includes("{{unsubscribe")) return;
        return {
          info: row
            ? `template "${row.name}" has no {{unsubscribe}} — subscribers cannot leave the list`
            : "there is no email template — newsletters go out without an unsubscribe link",
          ...!row && { solutions: { "create the newsletter template": { solve: () => setup(app).then(() => "created") } } },
        };
      },

      "scheduled newsletters go out": async () => {
        const late = Number(await app.db.one`SELECT COUNT(*) FROM message_delivery d
          JOIN message m ON m.id = d.message_id JOIN grp g ON g.id = m.grp_id AND g.type = ${TYPE}
          WHERE m.channel = ${CHANNEL} AND d.sent IS NULL AND d.due < ${unixTime() - LATE}`);
        if (late) return { info: `${late} deliveries are overdue by more than ten minutes — is the cron job running?` };
      },

    },
    notice: {

      // links are tracked through short codes: without shorturl a newsletter has no statistics
      "newsletters are tracked": () => Promise.resolve(app.modules.linked("shorturl")
        ? undefined
        : { info: "without the module shorturl, opens and clicks of newsletters are not counted" }),

      // the sender's identity and postal address belong in a newsletter (UWG Art. 3 o, CAN-SPAM)
      "newsletters say who sends them": async () => {
        const row = await draftTemplate(app);
        if (!row || row.text.includes("{{identity.organization.address")) return;
        return { info: `template "${row.name}" has no sender address ({{identity.organization.address.formatted}})` };
      },

    },
  };
}
