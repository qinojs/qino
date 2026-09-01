import { assertEquals } from "./deps.ts";
import { limited, setMaxProcesses } from "../lib/transform/limit.ts";

Deno.test("limited: never runs more than the cap at once, and runs everything", async () => {
  setMaxProcesses(2);
  let now = 0, peak = 0, done = 0;
  await Promise.all([...Array(10)].map(() =>
    limited(async () => {
      peak = Math.max(peak, ++now);
      await new Promise((r) => setTimeout(r, 5));
      now--;
      done++;
    })
  ));
  assertEquals(peak, 2);
  assertEquals(done, 10);
});

Deno.test("limited: a failing job releases its slot", async () => {
  setMaxProcesses(1);
  await limited(() => Promise.reject(new Error("boom"))).catch(() => {});
  assertEquals(await limited(() => Promise.resolve("free")), "free");
});
