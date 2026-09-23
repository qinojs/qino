/** Run git, never interactive (a credential prompt would hang the request); with timeout. */
export async function git(dir: string, args: string[], timeout = 30_000): Promise<{ ok: boolean; out: string }> {
  const cmd = new Deno.Command("git", {
    args: ["-C", dir, ...args],
    env: { GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "true", GIT_OPTIONAL_LOCKS: "0" },
    stdout: "piped",
    stderr: "piped",
    signal: AbortSignal.timeout(timeout),
  });
  const { success, stdout, stderr } = await cmd.output().catch((e) => ({ success: false, stdout: new Uint8Array(), stderr: new TextEncoder().encode(String(e?.message ?? e)) }));
  const text = new TextDecoder();
  return { ok: success, out: (text.decode(stdout) + text.decode(stderr)).trim() };
}

/** The letters VS Code shows, so both say the same thing about the same file:
 *  M modified · A added · D deleted · R renamed · U untracked · C conflicted */
export type Change = { code: string; path: string };
export type Repo<T = unknown> = { root: string; branch: string; ref: string; ahead: number; behind: number; files: Change[]; holds: T[] };

// Where the path starts in a porcelain v2 entry — the field count differs per line type.
const PATH_AT: Record<string, number> = { "1": 8, "2": 9, u: 10 };

/** Branch, tracking distance and working-copy changes from porcelain v2. */
export async function status(root: string): Promise<Omit<Repo, "root" | "holds">> {
  // -uall, or a wholly new directory arrives as a single entry and hides what is in it.
  const { ok, out } = await git(root, ["status", "--porcelain=v2", "--branch", "-uall"]);
  const res = { branch: "", ref: "", ahead: 0, behind: 0, files: [] as Change[] };
  if (!ok) return res;
  for (const line of out.split("\n")) {
    if (line.startsWith("# branch.head ")) res.branch = line.slice(14);
    else if (line.startsWith("# branch.ab ")) {
      const [a, b] = line.slice(12).split(" ");
      res.ahead = Number(a);
      res.behind = -Number(b);
    } else if (line.startsWith("? ")) res.files.push({ code: "U", path: line.slice(2) });
    else if (line[1] === " " && PATH_AT[line[0]]) {
      const field = line.split(" ");
      // XY = staged and worktree state; a dot means unchanged, so take the other letter.
      res.files.push({
        code: line[0] === "u" ? "C" : field[1].replace(/\./g, "")[0] ?? "M",
        path: field.slice(PATH_AT[line[0]]).join(" ").split("\t")[0],
      });
    }
  }
  if (res.branch === "(detached)") {
    const tag = await git(root, ["describe", "--tags", "--exact-match", "HEAD"]);
    if (tag.ok) res.ref = `refs/tags/${tag.out}`;
  } else if (res.branch) res.ref = `refs/heads/${res.branch}`;
  return res;
}

/** Branches and tags available for checkout; omit symbolic remote HEAD aliases. */
export async function refs(root: string): Promise<string[]> {
  const { ok, out } = await git(root, ["for-each-ref", "--sort=-version:refname", "--format=%(refname)%09%(symref)", "refs/heads", "refs/remotes", "refs/tags"]);
  if (!ok) throw new Error(out);
  return out.split("\n").filter(Boolean)
    .map((line) => line.split("\t"))
    .filter(([, target]) => !target)
    .map(([ref]) => ref);
}

/** The repositories of these directories — one `rev-parse` per repo (directories inside a known root
 *  are skipped). */
export async function reposOf<T>(dirs: Map<string, T>): Promise<Map<string, T[]>> {
  const roots = new Map<string, T[]>();
  for (const [dir, holds] of [...dirs].sort(([a], [b]) => a.localeCompare(b))) {
    const known = [...roots.keys()].find((root) => dir.startsWith(root));
    if (known) { roots.get(known)!.push(holds); continue; }
    const { ok, out } = await git(dir, ["rev-parse", "--show-toplevel"], 5_000);
    if (!ok) continue; // not a repository, or git cannot read it
    const root = out.endsWith("/") ? out : out + "/";
    roots.set(root, [...(roots.get(root) ?? []), holds]);
  }
  return roots;
}
