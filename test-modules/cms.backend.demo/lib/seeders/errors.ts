// Client and server errors, as the error_report module collects them.
import type { Seed } from "../seed.ts";

const MESSAGES: [string, string, string][] = [
  ["TypeError: undefined is not a function", "pub/main.js", "js"],
  ["ReferenceError: cms is not defined", "pub/edit.mjs", "js"],
  ["Failed to fetch", "pub/qino.js", "js"],
  ["ResizeObserver loop completed with undelivered notifications", "u2/js/layout.js", "js"],
  ["Cannot read properties of null (reading 'closest')", "pub/main.js", "js"],
  ["unknown table: shp_order", "module/shp3/plugin.ts", "server"],
  ["Deadline exceeded while rendering node 42", "module/cms/lib/Node.ts", "server"],
];

export async function run(s: Seed): Promise<void> {
  const base = await s.url();
  for (let i = 0; i < s.many(25); i++) {
    const [message, file, source] = s.rnd.pick(MESSAGES);
    const ua = s.rnd.ua();
    await s.db.table("m_error_report").insert({
      time: new Date(s.rnd.past(60, s.now) * 1000).toISOString().slice(0, 19).replace("T", " "),
      source,
      message,
      file: `${base}/${file}`,
      line: s.rnd.int(1, 400),
      col: s.rnd.int(1, 120),
      prio: s.rnd.pick(["error", "error", "warn", "info"]),
      sample: s.rnd.sentence(),
      backtrace: `at ${s.rnd.words(1)} (${file}:${s.rnd.int(1, 400)})\nat handler (${file}:${s.rnd.int(1, 400)})`,
      browser: ua,
      request: `${base}/${s.rnd.words(1)}`,
      referer: s.rnd.referer(),
      ip: s.rnd.ip(),
      bot: /bot/i.test(ua),
      unsupported_ua: false,
    });
    s.count("error reports");
  }
}
