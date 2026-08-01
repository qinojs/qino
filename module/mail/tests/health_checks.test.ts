// deno-lint-ignore-file no-explicit-any
import { assertEquals } from "../../core/tests/deps.ts";
import { requestStorage } from "../../core/mod.ts";
import { healthChecks } from "../healthChecks.ts";

function setting(initial: string, writes: any[]) {
  const item: any = (value: string) => {
    let resolve!: (value: unknown) => void;
    const promise = new Promise<unknown>((done) => resolve = done);
    writes.push({ value, resolve });
    return promise;
  };
  item.then = (resolve: (value: string) => unknown, reject: (reason: unknown) => unknown) =>
    Promise.resolve(initial).then(resolve, reject);
  return item;
}

Deno.test("mail health solutions await settings writes", async () => {
  const writes: any[] = [];
  const app = { settings: { mail: {
    sender: setting("old@example.invalid", writes),
    reply_to: setting("old@example.invalid", writes),
    debug_to: setting("", writes),
  } } };
  const ctx = {
    req: { url: new URL("https://www.example.test/") },
    user: { get: (key: string) => key === "superuser" ? true : "admin@example.test" },
  };
  const types = healthChecks(app as never);

  await requestStorage.run(ctx as never, async () => {
    for (const check of Object.values(types.notice)) {
      const result = await check();
      const solution = Object.values(result!.solutions!)[0];
      let done = false;
      const solved = Promise.resolve(solution.solve()).then((value) => { done = true; return value; });
      await Promise.resolve();
      assertEquals(done, false);
      writes.at(-1).resolve({ written: true });
      assertEquals(await solved, undefined);
      assertEquals(done, true);
    }
  });

  assertEquals(writes.map(({ value }) => value), ["info@example.test", "info@example.test", "admin@example.test"]);
  for (const check of Object.values(types.notice)) assertEquals(await check(), undefined);
});
