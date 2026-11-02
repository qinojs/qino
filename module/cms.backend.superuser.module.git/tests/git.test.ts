import { test } from "node:test";
import { fs } from "@qino/qino";
import { assert, assertEquals } from "@qino/qino/tests";

import { git, refs, reposOf, status } from "../lib/git.ts";

/** A real repository: the parsing is only worth testing against git's actual output. */
async function repo() {
  const dir = await fs.tempDir() + "/";
  await git(dir, ["init", "-q", "-b", "main"]);
  await fs.write(dir + "kept.txt", "one\n");
  await git(dir, ["add", "-A"]);
  await git(dir, ["-c", "user.name=T", "-c", "user.email=t@e.test", "commit", "-qm", "first"]);
  return dir;
}

test("git: branches and older tags can be selected without losing their identity", async () => {
  const dir = await repo();
  await git(dir, ["tag", "v1.0.0"]);
  await fs.write(dir + "kept.txt", "two\n");
  await git(dir, ["add", "-A"]);
  await git(dir, ["-c", "user.name=T", "-c", "user.email=t@e.test", "commit", "-qm", "second"]);
  await git(dir, ["tag", "v2.0.0"]);

  assertEquals((await refs(dir)).filter((ref) => ref.startsWith("refs/tags/")), ["refs/tags/v2.0.0", "refs/tags/v1.0.0"]);
  await git(dir, ["switch", "--detach", "--", "refs/tags/v1.0.0"]);
  const old = await status(dir);
  assertEquals([old.branch, old.ref], ["(detached)", "refs/tags/v1.0.0"]);
  await git(dir, ["switch", "--", "main"]);
  assertEquals((await status(dir)).ref, "refs/heads/main");

  const remote = await fs.tempDir();
  await git(remote, ["init", "--bare", "-q"]);
  await git(dir, ["remote", "add", "origin", remote]);
  await git(dir, ["push", "-q", "-u", "origin", "main"]);
  await git(dir, ["switch", "-qc", "preview"]);
  await git(dir, ["push", "-q", "origin", "preview"]);
  await git(dir, ["switch", "-q", "main"]);
  await git(dir, ["branch", "-D", "preview"]);
  assert((await refs(dir)).includes("refs/remotes/origin/preview"));
  assertEquals((await git(dir, ["switch", "--track", "--", "origin/preview"])).ok, true);
  assertEquals((await status(dir)).ref, "refs/heads/preview");

  await fs.remove(dir, { recursive: true });
  await fs.remove(remote, { recursive: true });
});

test("git: status reports branch and every kind of change", async () => {
  const dir = await repo();
  const clean = await status(dir);
  assertEquals(clean.branch, "main");
  assertEquals(clean.files, [], "a fresh commit leaves nothing behind");
  assertEquals([clean.ahead, clean.behind], [0, 0], "no upstream is no distance");

  await fs.write(dir + "kept.txt", "two\n"); // modified, tracked
  await fs.write(dir + "fresh.txt", "new\n"); // untracked
  await fs.mkdir(dir + "neu/"); // a new directory must not collapse into one entry
  await fs.write(dir + "neu/tief.txt", "deep\n");
  await fs.write(dir + "gone.txt", "x\n");
  await git(dir, ["add", "gone.txt"]);
  await git(dir, ["-c", "user.name=T", "-c", "user.email=t@e.test", "commit", "-qm", "second"]);
  await fs.remove(dir + "gone.txt");
  // A rename carries an extra field before the path — the offset that is easy to get wrong.
  await git(dir, ["mv", "kept.txt", "moved.txt"]);

  const dirty = await status(dir);
  const seen = Object.fromEntries(dirty.files.map((file) => [file.path, file.code]));
  assertEquals(seen, { "fresh.txt": "U", "gone.txt": "D", "moved.txt": "R", "neu/tief.txt": "U" });

  await fs.remove(dir, { recursive: true });
});

test("git: directories of one repository collapse into it, foreign ones stay out", async () => {
  const dir = await repo();
  await fs.mkdir(dir + "module/a.one/");
  const outside = await fs.tempDir() + "/"; // no repository at all

  const found = await reposOf(new Map([
    [dir, "app"],
    [dir + "module/a.one/", "a.one"],
    [outside, "elsewhere"],
  ]));

  assertEquals(found.size, 1, "one repository, whatever lies inside it");
  const [[root, holds]] = [...found];
  assert(root.endsWith("/"), "a root is a directory");
  assertEquals(holds.sort(), ["a.one", "app"]);

  await fs.remove(dir, { recursive: true });
  await fs.remove(outside, { recursive: true });
});
