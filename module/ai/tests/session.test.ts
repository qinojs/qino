import { ApiError } from "@qino/qino";
import { assertEquals } from "@qino/qino/tests";

import { ChatSession } from "../lib/ChatSession.ts";
import { sse } from "../lib/sse.ts";

for (const streaming of [false, true]) {
  Deno.test(`ai: tool errors stay private in ${streaming ? "streaming" : "regular"} chats and history`, async () => {
    const secret = "SELECT password FROM usr /private/key secret-token";
    const failures = [new Error(secret, { cause: new Error(secret) }), secret, { toString: () => secret }, new SyntaxError(secret)];
    const publicError = new ApiError(422, "Choose a language", { code: "language", data: { allowed: ["en", "de"] } });
    const cases = [
      ...failures.map(error => ({ args: "{}", execute: () => { throw error; }, expected: { error: "Tool execution failed" } })),
      { args: "{}", execute: () => { throw publicError; }, expected: { error: publicError.message, code: publicError.code, data: publicError.data } },
      { args: "{}", execute: () => ({ text: "translated" }), expected: { text: "translated" } },
      { args: "{}", execute: () => ({ error: "Please select a page" }), expected: { error: "Please select a page" } },
      { args: '{"secret":', execute: () => { throw new Error("Malformed arguments must not execute"); }, expected: { error: "Invalid tool arguments: expected JSON" } },
    ];
    const calls = cases.map((test, index) => ({ id: String(index), type: "function", function: { name: `tool_${index}`, arguments: test.args } }));
    const rows: Record<string, unknown>[] = [];
    const requests: Record<string, unknown>[][] = [];
    const logged: unknown[][] = [];
    const app = { db: {
      row: () => ({ user_id: 1, bot: "test" }),
      query: (strings: TemplateStringsArray) => {
        const query = strings.join("");
        if (query.includes("ai_message")) return rows.slice();
        return query.includes("ai_provider_model") ? [] : [{ id: 1, name: "test" }];
      },
      table: () => ({ insert: (row: Record<string, unknown>) => rows.push(row), update: () => {} }),
    } };
    const api = {
      getBot: () => ({ systemPrompt: "Test", model: "test", tools: cases.map((test, index) => ({ name: `tool_${index}`, parameters: {}, execute: test.execute })) }),
      client: () => ({ stream: (_path: string, body: { messages: Record<string, unknown>[] }) => {
        requests.push(structuredClone(body.messages));
        const delta = requests.length === 1 ? { tool_calls: calls.map((call, index) => ({ ...call, index })) } : { content: "Finished" };
        return new Response(new TextDecoder().decode(sse({ choices: [{ delta }] })));
      } }),
    };
    const session = new ChatSession(app as never, api as never, 1);
    const ctx = { userId: 1, app: { dev: true } } as never;
    const originalError = console.error;
    console.error = (...args: unknown[]) => { logged.push(args); };
    try {
      for (let turn = 0; turn < 2; turn++) {
        if (streaming) {
          const response = await new Response(session.runStream("Hello", ctx)).text();
          assertEquals(response.includes('"done":"Finished"'), true);
          assertEquals(response.includes(secret), false);
        } else assertEquals(await session.run("Hello", ctx), "Finished");
      }
    } finally {
      console.error = originalError;
    }
    const expected = cases.map(test => test.expected);
    for (const messages of [rows, ...requests.slice(1)]) {
      assertEquals(messages.filter(row => row.role === "tool").map(row => JSON.parse(String(row.content))), expected);
      assertEquals(JSON.stringify(messages).includes(secret), false);
    }
    assertEquals(logged.map(args => args.at(-1)), failures);
  });
}
