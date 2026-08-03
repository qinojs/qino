import { assertEquals } from "./deps.ts";
import { App, appPathInstances } from "../mod.ts";

// Counts per resolved appPATH, so the health check can warn about instances sharing data/, cache/ and tmp/.
Deno.test({
  name: "appPathInstances counts the apps behind one appPATH",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const dir = await Deno.makeTempDir() + "/";
    assertEquals(appPathInstances(dir), 0);

    new App({ appPATH: dir, db: `sqlite:${dir}a.sqlite` });
    assertEquals(appPathInstances(dir), 1);

    new App({ appPATH: dir.slice(0, -1), db: `sqlite:${dir}b.sqlite` }); // same path, no trailing slash
    assertEquals(appPathInstances(dir), 2);

    const other = await Deno.makeTempDir() + "/";
    assertEquals(appPathInstances(other), 0);
    await Deno.remove(dir, { recursive: true });
    await Deno.remove(other, { recursive: true });
  },
});
