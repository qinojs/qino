export interface GitStatus {
  branch: string;
  dirty: boolean;
  ahead: number;
  behind: number;
  files: { status: string; path: string }[];
}

export interface GitCommit {
  hash: string;
  shortHash: string;
  message: string;
  author: string;
  date: string;
}

async function run(args: string[], cwd: string): Promise<{ stdout: string; stderr: string; code: number }> {
  const cmd = new Deno.Command("git", { args, cwd, stdout: "piped", stderr: "piped" });
  const { stdout, stderr, code } = await cmd.output();
  return {
    // trimEnd only: porcelain status lines start with a significant leading column
    stdout: new TextDecoder().decode(stdout).trimEnd(),
    stderr: new TextDecoder().decode(stderr).trim(),
    code,
  };
}

export async function findGitRoot(dir: string): Promise<string | null> {
  const { stdout, code } = await run(["rev-parse", "--show-toplevel"], dir);
  return code === 0 ? stdout : null;
}

export async function getStatus(repoPath: string): Promise<GitStatus> {
  const [branchRes, statusRes, aheadBehindRes] = await Promise.all([
    run(["rev-parse", "--abbrev-ref", "HEAD"], repoPath),
    run(["status", "--porcelain"], repoPath),
    run(["rev-list", "--left-right", "--count", "HEAD...@{upstream}"], repoPath),
  ]);

  const branch = branchRes.code === 0 ? branchRes.stdout : "unknown";
  const files = statusRes.stdout
    ? statusRes.stdout.split("\n").map(line => ({
        status: line.slice(0, 2).trim(),
        path: line.slice(3),
      }))
    : [];

  let ahead = 0, behind = 0;
  if (aheadBehindRes.code === 0 && aheadBehindRes.stdout) {
    const parts = aheadBehindRes.stdout.split(/\s+/);
    ahead = parseInt(parts[0], 10) || 0;
    behind = parseInt(parts[1], 10) || 0;
  }

  return { branch, dirty: files.length > 0, ahead, behind, files };
}

export async function getLog(repoPath: string, limit = 20): Promise<GitCommit[]> {
  const { stdout, code } = await run(
    ["log", `--max-count=${limit}`, "--format=%H%x1f%h%x1f%s%x1f%an%x1f%ai"],
    repoPath,
  );
  if (code !== 0 || !stdout) return [];
  return stdout.split("\n").map(line => {
    const [hash, shortHash, message, author, date] = line.split("\x1f");
    return { hash, shortHash, message, author, date };
  });
}

export async function getTags(repoPath: string): Promise<string[]> {
  const { stdout, code } = await run(["tag", "--list", "--sort=-creatordate"], repoPath);
  if (code !== 0 || !stdout) return [];
  return stdout.split("\n").filter(Boolean);
}

export async function pull(repoPath: string): Promise<string> {
  const { stdout, stderr, code } = await run(["pull"], repoPath);
  if (code !== 0) throw new Error(stderr || stdout);
  return stdout;
}

export async function push(repoPath: string): Promise<string> {
  const { stdout, stderr, code } = await run(["push"], repoPath);
  if (code !== 0) throw new Error(stderr || stdout);
  return stdout;
}

// reject values that git would interpret as options (argument injection)
function assertNoOption(value: string, name: string): void {
  if (value.startsWith("-")) throw new Error(`invalid ${name}`);
}

export async function checkout(repoPath: string, ref: string): Promise<string> {
  assertNoOption(ref, "ref");
  const { stdout, stderr, code } = await run(["checkout", ref], repoPath);
  if (code !== 0) throw new Error(stderr || stdout);
  return stdout;
}

export async function clone(url: string, targetDir: string): Promise<string> {
  assertNoOption(url, "url");
  const { stdout, stderr, code } = await run(["clone", "--", url, targetDir], Deno.cwd());
  if (code !== 0) throw new Error(stderr || stdout);
  return stdout;
}
