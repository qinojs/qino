import { assertEquals } from "../../core/tests/deps.ts";
import { init } from "../plugin.ts";
import type { Bot } from "../../ai/types.ts";

Deno.test("cms.frontend.ai: registers the bot and loads its frontend script in editmode", () => {
  const bots: Bot[] = [];
  const handlers: Record<string, ((data: Record<string, unknown>) => void)[]> = {};
  const app = {
    ai: { registerBot: (bot: Bot) => bots.push(bot) },
    on(name: string, fn: (data: Record<string, unknown>) => void) {
      (handlers[name] ??= []).push(fn);
    },
  };
  init(app as never);
  assertEquals(bots.map((b) => b.id), ["cms-helper"]);

  const scripts: string[] = [];
  const ctx = { get: {}, cms: { editmode: true }, sysURL: "/m/", html: { scripts: { add: (u: string) => scripts.push(u) } } };
  handlers["cms-ready"][0]({ ctx });
  assertEquals(scripts, ["/m/cms.frontend.ai/pub/init.mjs"]);

  // no script outside editmode
  scripts.length = 0;
  handlers["cms-ready"][0]({ ctx: { ...ctx, cms: { editmode: false } } });
  assertEquals(scripts, []);
});
