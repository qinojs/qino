import { assertEquals, fakeAi } from "@qino/qino/tests";

import { init } from "../plugin.ts";

import type { Bot } from "@qino/qino/ai";

Deno.test("cms.frontend.ai: registers the bot and loads its frontend script in editmode", () => {
  const bots: Bot[] = [];
  const handlers: Record<string, ((data: Record<string, unknown>) => void)[]> = {};
  const app = {
    on(name: string, fn: (data: Record<string, unknown>) => void) {
      (handlers[name] ??= []).push(fn);
    },
  };
  fakeAi(app, { registerBot: (bot: Bot) => bots.push(bot) } as never);
  init(app as never, { signal: new AbortController().signal });
  assertEquals(bots.map((b) => b.id), ["cms-helper"]);

  const scripts: string[] = [];
  const ctx = {
    req: { query: {}, moduleUrl: "/m/" },
    state: { cms: { editmode: true } },
    res: { html: { scripts: { add: (u: string) => scripts.push(u) } }, csp: { "script-src": {} } },
  };
  handlers["cms:page-ready"][0]({ ctx });
  assertEquals(scripts, ["/m/cms.frontend.ai/pub/init.mjs"]);

  // no script outside editmode
  scripts.length = 0;
  handlers["cms:page-ready"][0]({ ctx: { ...ctx, state: { cms: { editmode: false } } } });
  assertEquals(scripts, []);
});
