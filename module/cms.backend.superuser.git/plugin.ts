import { fromFileUrl } from "@std/path";
import { errMsg, getCtx, html } from "@qino/qino";
import { backend } from "@qino/qino/cms.backend";

import { git, refs, reposOf, status } from "./lib/git.ts";
import manifest from "./manifest.json" with { type: "json" };

import type { App, HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";
import type { Repo } from "./lib/git.ts";

const { name } = manifest;

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, name, { en: "Git", de: "Git" });
}

/** All directories of the app (modules, stores, the app itself). Git decides which share a repo. */
type Holds = { kind: "app" | "module" | "store"; label: string };

function candidates(app: App): Map<string, Holds> {
  const dirs = new Map<string, Holds>([[app.dir, { kind: "app", label: app.dir }]]);
  for (const mod of app.modules.all().values()) if (mod.dir) dirs.set(mod.dir, { kind: "module", label: mod.name });
  for (const store of app.stores.all()) {
    if (!store.base.startsWith("file:")) continue;
    const dir = fromFileUrl(store.base);
    dirs.set(dir, { kind: "store", label: dir.split("/").filter(Boolean).at(-1) ?? dir });
  }
  return dirs;
}

async function repos(app: App): Promise<Repo<Holds>[]> {
  const found = await reposOf(candidates(app));
  return Promise.all(found.entries().map(async ([root, holds]) => ({ root, holds, ...await status(root) })));
}

/** Contents of a repository in one line: names if few, else counts. */
async function summary(holds: Holds[], t: App["t"]): Promise<string> {
  const [modules, stores, app] = await Promise.all([t`modules`, t`stores`, t`the app`]);
  const some = (kind: Holds["kind"], word: string) => {
    const list = holds.filter((hold) => hold.kind === kind);
    return !list.length ? "" : list.length === 1 ? list[0].label : `${list.length} ${word}`;
  };
  return [some("module", modules), some("store", stores), some("app", app)].filter(Boolean).join(" · ");
}

// --- actions --------------------------------------------------------------

/** The backend user is the author: a commit that says "the server" answers nobody's question. */
async function author(): Promise<string[]> {
  const user = getCtx().user;
  const parts = [user?.given_name, user?.family_name].filter(Boolean).join(" ");
  const email = await user?.contact("email") ?? ""; // an address, not the login handle
  const name = parts || String(user?.username ?? "") || email;
  if (!name && !email) return [];
  return ["-c", `user.name=${name}`, "-c", `user.email=${email}`];
}

/** Whether a supervisor restarts the process: systemd sets INVOCATION_ID, others QINO_SUPERVISED. */
function supervised(): boolean {
  try {
    return !!(Deno.env.get("INVOCATION_ID") ?? Deno.env.get("QINO_SUPERVISED"));
  } catch {
    return false; // no --allow-env, so nothing to go on: assume nobody is watching
  }
}

/** Deno keeps its loaded modules, so pulled code needs a restart: exit and let the supervisor start
 *  it again. Non-zero, so `Restart=on-failure` works too. */
function restart(): string {
  if (!supervised()) throw new Error("No service manager found — the process would stay down. Set QINO_SUPERVISED=1 if one is watching.");
  // In-flight requests end with the process; a delay long enough for this answer is what it gets.
  setTimeout(() => Deno.exit(75), 500);
  return "Restarting — the page reloads once the server answers again.";
}

async function act(app: App, action: string, root: string, message: string): Promise<{ message: string; restarting?: boolean }> {
  if (action === "restart") return { message: restart(), restarting: true }; // the process, not a repository — no root to check
  // Never a path from the client: only a repository this app actually sits in may be touched.
  const known = await repos(app);
  const repo = known.find((r) => r.root === root);
  if (!repo) throw new Error(`Not a repository of this app: ${root}`);

  if (action === "update") {
    if (repo.branch === "(detached)") throw new Error("Select a branch before updating.");
    // Status compares with the remote-tracking ref, so refresh it first.
    run(await git(repo.root, ["fetch"], 120_000));
    run(await git(repo.root, ["rev-parse", "--verify", "@{upstream}"]));
    const current = await status(repo.root);
    if (!current.behind) return { message: "Already up to date." };
    if (!supervised()) throw new Error("No service manager found — the process would stay down.");
    const out = run(await git(repo.root, ["pull", "--ff-only"], 120_000));
    return { message: `${out}\n${restart()}`, restarting: true };
  }
  if (action === "switch") {
    if (!message || !(await refs(repo.root)).includes(message)) throw new Error(`Unknown version: ${message}`);
    if (repo.ref === message) return { message: "Already selected." };
    if (repo.files.length) throw new Error("Commit or discard local changes before switching versions.");
    if (!supervised()) throw new Error("No service manager found — the process would stay down.");
    const args = message.startsWith("refs/tags/") ? ["switch", "--detach", "--", message]
      : message.startsWith("refs/heads/") ? ["switch", "--", message.slice(11)]
      : ["switch", "--track", "--", message.slice(13)];
    const out = run(await git(repo.root, args));
    return { message: `${out}\n${restart()}`, restarting: true };
  }
  if (action === "fetch") return { message: run(await git(repo.root, ["fetch"], 120_000)) };
  if (action === "push") return { message: run(await git(repo.root, ["push"], 120_000)) };
  if (action === "pull") return { message: run(await git(repo.root, ["pull", "--ff-only"], 120_000)) };
  // Tracked edits go, untracked files stay: module data/cache/tmp live inside these directories.
  if (action === "reset") {
    const fetched = await git(repo.root, ["fetch"], 120_000);
    if (!fetched.ok) throw new Error(fetched.out);
    return { message: run(await git(repo.root, ["reset", "--hard", "@{upstream}"])) };
  }
  if (action !== "commit") throw new Error(`Unknown action: ${action}`);

  if (!message.trim()) throw new Error("A commit needs a message");
  if (!repo.files.length) throw new Error("Nothing to commit");
  const add = await git(repo.root, ["add", "-A"]);
  if (!add.ok) throw new Error(add.out);
  return { message: run(await git(repo.root, [...await author(), "commit", "-m", message])) };
}

const run = ({ ok, out }: { ok: boolean; out: string }) => {
  if (!ok) throw new Error(out || "git failed");
  return out || "done";
};

// --- view -----------------------------------------------------------------

async function repoCard(repo: Repo<Holds>, t: App["t"]): Promise<HtmlString> {
  const dirty = repo.files.length;
  const available = await refs(repo.root);
  const branches = available.filter((ref) => ref.startsWith("refs/heads/"));
  const local = new Set(branches.map((ref) => ref.slice(11)));
  const remote = available.filter((ref) => ref.startsWith("refs/remotes/") && !local.has(ref.split("/").slice(3).join("/")));
  const tags = available.filter((ref) => ref.startsWith("refs/tags/"));
  const options = (list: string[], prefix: string) => list.map((ref) => html`<option value="${ref}"${ref === repo.ref ? html` selected` : ""}>${ref.slice(prefix.length)}</option>`);
  return html.async`<div class=u2-card data-repo="${repo.root}">
  <div class=-head><code>${repo.root}</code></div>
  <div>
    <div><b>${repo.ref.startsWith("refs/tags/") ? repo.ref.slice(10) : repo.branch || "?"}</b>
      ${repo.ahead ? html`<span class=-ahead>↑${repo.ahead}</span>` : ""}
      ${repo.behind ? html`<span class=-behind>↓${repo.behind}</span>` : ""}
      <small title="${repo.holds.map((hold) => hold.label).join("\n")}">${summary(repo.holds, t)}</small>
    </div>
    ${
    dirty
      ? html.async`<details${dirty <= 12 ? html` open` : ""}>
          <summary>${dirty} ${t`changed files`}</summary>
          <table class="u2-table -changes">${
        repo.files.map((file) => html`<tr><td class="-code -${file.code}">${file.code}<td>${file.path}`)
        }</table>
        </details>
        <button data-act=commit>${t`Commit`}</button>`
      : html.async`<small>${t`nothing changed`}</small>`
  }
    <button data-act=update u2-confirm="${t`Fetch, pull and restart the server if code changed?`}"${repo.branch === "(detached)" ? html` disabled` : ""}>${t`Update`}</button>
    <details><summary>${t`Advanced`}</summary>
      <label>${t`Version`}<br><select name=ref>
        <option value="">${t`Select version`}</option>
        <optgroup label="${t`Branches`}">${options(branches, "refs/heads/")}</optgroup>
        <optgroup label="${t`Remote branches`}">${options(remote, "refs/remotes/")}</optgroup>
        <optgroup label="${t`Tags`}">${options(tags, "refs/tags/")}</optgroup>
      </select></label>
      <button data-act=switch>${t`Switch`}</button>
      <div>
        <button data-act=fetch>${t`Fetch`}</button>
        <button data-act=push${repo.branch === "(detached)" || !repo.ahead ? html` disabled` : ""}>${t`Push`}</button>
        <button data-act=pull${repo.branch === "(detached)" || !repo.behind ? html` disabled` : ""}>${t`Pull`}</button>
        <button data-act=reset data-confirm="${t`Discard all local changes and reset to the remote?`}"${repo.branch === "(detached)" ? html` disabled` : ""}>${t`Reset to remote`}</button>
      </div>
    </details>
  </div>
</div>`;
}

/** The process, shown once next to the repositories (a restart loads what a pull changed). */
function serverCard(t: App["t"]): Promise<HtmlString> {
  const can = supervised();
  return html.async`<div class=u2-card>
  <details><summary>${t`Server`}</summary>
    <small>${can ? t`Pulled code is loaded on the next start.` : t`No service manager: nothing would start the process again.`}</small>
    <button data-act=restart data-confirm="${t`Restart the server now? The site is unreachable for a moment.`}"${can ? "" : html` disabled`}>${t`Restart`}</button>
  </details>
</div>`;
}

async function render(node: Node): Promise<HtmlString> {
  const t = node.app.t;
  const found = await repos(node.app);
  const cards = found.length ? found.map((repo) => repoCard(repo, t)) : [html.async`<div class=u2-card><div>${t`No git repository found.`}</div></div>`];
  return html.async`<div class="u2-flex git-repos">${cards}${serverCard(t)}</div>`;
}

// --- node API -------------------------------------------------------------

async function api(node: Node, vars: Record<string, unknown>): Promise<{ ok: boolean; message: string; restarting?: boolean }> {
  try {
    return { ok: true, ...await act(node.app, String(vars.act ?? ""), String(vars.repo ?? ""), String(vars.message ?? "")) };
  } catch (e) {
    return { ok: false, message: errMsg(e) };
  }
}

export const cms = {
  node: { css: ["pub/main.css"], js: ["pub/main.js"], render, api },
};
