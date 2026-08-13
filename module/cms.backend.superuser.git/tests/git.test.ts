import { assert, assertEquals } from "@qino/qino/tests";
import { git, reposOf, status } from "../lib/git.ts";

/** A real repository: the parsing is only worth testing against git's actual output. */
async function repo(): Promise<string> {
  const dir = await Deno.makeTempDir() + "/";
  await git(dir, ["init", "-q", "-b", "main"]);
  await Deno.writeTextFile(dir + "kept.txt", "one\n");
  await git(dir, ["add", "-A"]);
  await git(dir, ["-c", "user.name=T", "-c", "user.email=t@e.test", "commit", "-qm", "first"]);
  return dir;
}

Deno.test({
  name: "git: status reports branch and every kind of change",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const dir = await repo();
    const clean = await status(dir);
    assertEquals(clean.branch, "main");
    assertEquals(clean.files, [], "a fresh commit leaves nothing behind");
    assertEquals([clean.ahead, clean.behind], [0, 0], "no upstream is no distance");

    await Deno.writeTextFile(dir + "kept.txt", "two\n"); // modified, tracked
    await Deno.writeTextFile(dir + "fresh.txt", "new\n"); // untracked
    await Deno.mkdir(dir + "neu/"); // a new directory must not collapse into one entry
    await Deno.writeTextFile(dir + "neu/tief.txt", "deep\n");
    await Deno.writeTextFile(dir + "gone.txt", "x\n");
    await git(dir, ["add", "gone.txt"]);
    await git(dir, ["-c", "user.name=T", "-c", "user.email=t@e.test", "commit", "-qm", "second"]);
    await Deno.remove(dir + "gone.txt");
    // A rename carries an extra field before the path — the offset that is easy to get wrong.
    await git(dir, ["mv", "kept.txt", "moved.txt"]);

    const dirty = await status(dir);
    const seen = Object.fromEntries(dirty.files.map((file) => [file.path, file.code]));
    assertEquals(seen, { "fresh.txt": "U", "gone.txt": "D", "moved.txt": "R", "neu/tief.txt": "U" });

    await Deno.remove(dir, { recursive: true });
  },
});

Deno.test({
  name: "git: directories of one repository collapse into it, foreign ones stay out",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const dir = await repo();
    await Deno.mkdir(dir + "module/a.one/", { recursive: true });
    const outside = await Deno.makeTempDir() + "/"; // no repository at all

    const found = await reposOf(new Map([
      [dir, "app"],
      [dir + "module/a.one/", "a.one"],
      [outside, "elsewhere"],
    ]));

    assertEquals(found.size, 1, "one repository, whatever lies inside it");
    const [[root, holds]] = [...found];
    assert(root.endsWith("/"), "a root is a directory");
    assertEquals(holds.sort(), ["a.one", "app"]);

    await Deno.remove(dir, { recursive: true });
    await Deno.remove(outside, { recursive: true });
  },
});
