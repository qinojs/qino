// A mail archive: what a site that has been running for a while would have sent.
import type { Seed } from "../seed.ts";

const TEMPLATES: [string, string, string][] = [
  ["demo-welcome", "Welcome", "<h1>Welcome, {{given_name}}</h1><p>Your account is ready.</p>"],
  ["demo-order", "Order confirmation", "<h1>Thank you</h1><p>Order {{order}} is on its way.</p>"],
  ["demo-newsletter", "Newsletter", "<h1>{{subject}}</h1><p>{{body}}</p><p><a href=\"{{unsubscribe}}\">Unsubscribe</a></p>"],
  ["demo-reset", "Password reset", "<p>Follow <a href=\"{{link}}\">this link</a> to choose a new password.</p>"],
];

export async function run(s: Seed): Promise<void> {
  if (s.table("mail_template")) {
    for (const [name, description, html] of TEMPLATES) {
      await s.db.table("mail_template").insert({ name, description, subject: description, html, created: s.now, updated: s.now });
      s.count("mail templates");
    }
  }

  for (let i = 0; i < s.many(30); i++) {
    const subject = s.rnd.subject(1000 + i);
    const body = s.rnd.paragraph();
    const id = await s.db.table("mail").insert({
      sender: "noreply@demo.example",
      sendername: "Demo site",
      subject,
      text: body,
      html: `<p>${body}</p>`,
      template: s.rnd.chance(0.5) ? s.rnd.pick(TEMPLATES)[0] : "",
      tags: s.rnd.pick(["", "newsletter", "transactional", "notice"]),
      priority: s.rnd.pick(["", "high", "low"]),
    });
    if (!id) continue;
    s.count("mails");

    for (const usr of s.rnd.some(s.usrs, s.rnd.int(1, 3))) {
      const sent = s.rnd.chance(0.85) ? s.rnd.past(120, s.now) : 0;
      await s.db.table("mail_recipient").insert({
        mail_id: id,
        email: usr.email,
        usr_id: usr.id,
        name: `${usr.given_name} ${usr.family_name}`,
        type: "to",
        sent,
        opened: sent && s.rnd.chance(0.5) ? sent + s.rnd.int(60, 86400) : 0,
        error: !sent && s.rnd.chance(0.4) ? "550 mailbox unavailable" : "",
      });
      s.count("recipients");
    }
  }
}
