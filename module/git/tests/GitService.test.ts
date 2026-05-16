import { assertEquals } from "../../core/tests/deps.ts";
import { findGitRoot, getLog, getStatus, getTags } from "../lib/GitService.ts";

async function git(args: string[], cwd: string): Promise<number> {
  const cmd = new Deno.Command("git", { args, cwd, stdout: "null", stderr: "null" });
  return (await cmd.output()).code;
}

Deno.test("git: GitService reads status, root, log and tags", async () => {
  const root = await Deno.makeTempDir();
  try {
    assertEquals(await git(["init"], root), 0);
    assertEquals(await git(["config", "user.email", "test@example.invalid"], root), 0);
    assertEquals(await git(["config", "user.name", "Qino Test"], root), 0);

    await Deno.writeTextFile(root + "/README.md", "hello\n");
    let status = await getStatus(root);
    assertEquals(status.dirty, true);
    assertEquals(status.files, [{ status: "??", path: "README.md" }]);

    assertEquals(await git(["add", "README.md"], root), 0);
    assertEquals(await git(["commit", "-m", "initial"], root), 0);
    assertEquals(await git(["tag", "v1"], root), 0);

    status = await getStatus(root);
    assertEquals(status.dirty, false);

    const sub = root + "/sub";
    await Deno.mkdir(sub);
    assertEquals(await findGitRoot(sub), root);

    const log = await getLog(root, 1);
    assertEquals(log.length, 1);
    assertEquals(log[0].message, "initial");
    assertEquals(log[0].author, "Qino Test");
    assertEquals(await getTags(root), ["v1"]);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
