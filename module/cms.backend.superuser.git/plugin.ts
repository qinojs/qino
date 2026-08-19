import { fromFileUrl } from "@std/path";
import { errMsg, getCtx, html } from "@qino/qino";
import { backend } from "@qino/qino/cms.backend";

import { git, reposOf, status } from "./lib/git.ts";
import manifest from "./manifest.json" with { type: "json" };

import type { App, HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";
import type { Repo } from "./lib/git.ts";

const { name } = manifest;

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, name, { en: "Git", de: "Git" });
}

/** Every directory the app is made of, and what it holds — modules, stores and the app itself.
 *  Which of them share a repository is git's answer, not ours. */
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

/** What lies in a repository, in one line: names while there are few, counts once there are many.
 *  The full list would be 120 module names and answers nothing the root path does not. */
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
  const parts = [user?.firstname, user?.lastname].filter(Boolean).join(" ");
  const email = String(user?.email ?? "");
  if (!parts && !email) return [];
  return ["-c", `user.name=${parts || email}`, "-c", `user.email=${email}`];
}

/** A supervisor is what makes ending the process a restart rather than an outage — systemd sets
 *  INVOCATION_ID for the services it starts, and QINO_SUPERVISED says so for every other one. */
function supervised(): boolean {
  try {
    return !!(Deno.env.get("INVOCATION_ID") ?? Deno.env.get("QINO_SUPERVISED"));
  } catch {
    return false; // no --allow-env, so nothing to go on: assume nobody is watching
  }
}

/** Pulled code reaches a running process nowhere: Deno keeps the module graph it started with.
 *  So the restart is an exit, and the supervisor brings the new graph up.
 *  Non-zero, or the `Restart=on-failure` an install may be running would leave it down. */
function restart(): string {
  if (!supervised()) throw new Error("No service manager found — the process would stay down. Set QINO_SUPERVISED=1 if one is watching.");
  // In-flight requests end with the process; a delay long enough for this answer is what it gets.
  setTimeout(() => Deno.exit(75), 500);
  return "Restarting — the page reloads once the server answers again.";
}

async function act(app: App, action: string, root: string, message: string): Promise<string> {
  if (action === "restart") return restart(); // the process, not a repository — no root to check
  // Never a path from the client: only a repository this app actually sits in may be touched.
  const known = await repos(app);
  const repo = known.find((r) => r.root === root);
  if (!repo) throw new Error(`Not a repository of this app: ${root}`);

  // Without a fetch "behind" stays at whatever the last one left behind: status reads the
  // remote-tracking ref, not the remote.
  if (action === "fetch") return run(await git(repo.root, ["fetch"], 120_000));
  if (action === "push") return run(await git(repo.root, ["push"], 120_000));
  if (action === "pull") return run(await git(repo.root, ["pull", "--ff-only"], 120_000));
  // Tracked edits go, untracked files stay: module data/cache/tmp live inside these directories.
  if (action === "reset") {
    const fetched = await git(repo.root, ["fetch"], 120_000);
    if (!fetched.ok) throw new Error(fetched.out);
    return run(await git(repo.root, ["reset", "--hard", "@{upstream}"]));
  }
  if (action !== "commit") throw new Error(`Unknown action: ${action}`);

  if (!message.trim()) throw new Error("A commit needs a message");
  if (!repo.files.length) throw new Error("Nothing to commit");
  const add = await git(repo.root, ["add", "-A"]);
  if (!add.ok) throw new Error(add.out);
  return run(await git(repo.root, [...await author(), "commit", "-m", message]));
}

const run = ({ ok, out }: { ok: boolean; out: string }) => {
  if (!ok) throw new Error(out || "git failed");
  return out || "done";
};

// --- view -----------------------------------------------------------------

function repoCard(repo: Repo<Holds>, t: App["t"]): Promise<HtmlString> {
  const dirty = repo.files.length;
  return html.async`<div class=u2-card data-repo="${repo.root}">
  <div class=-head><code>${repo.root}</code></div>
  <div class=-body>
    <div><b>${repo.branch || "?"}</b>
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
        <input name=message placeholder="${t`Commit message`}" style="width:100%">
        <button data-act=commit>${t`Commit`}</button>`
      : html.async`<small>${t`nothing changed`}</small>`
  }
    <button data-act=fetch>${t`Fetch`}</button>
    <button data-act=push${repo.ahead ? "" : html` disabled`}>${t`Push`}</button>
    <button data-act=pull${repo.behind ? "" : html` disabled`}>${t`Pull`}</button>
    <button data-act=reset data-confirm="${t`Discard all local changes and reset to the remote?`}">${t`Reset to remote`}</button>
  </div>
</div>`;
}

/** The process, once, next to the repositories: what a pull changes on disk is what a restart loads. */
function serverCard(t: App["t"]): Promise<HtmlString> {
  const can = supervised();
  return html.async`<div class=u2-card>
  <div class=-head>${t`Server`}</div>
  <div class=-body>
    <small>${can ? t`Pulled code is loaded on the next start.` : t`No service manager: nothing would start the process again.`}</small>
    <button data-act=restart data-confirm="${t`Restart the server now? The site is unreachable for a moment.`}"${can ? "" : html` disabled`}>${t`Restart`}</button>
  </div>
</div>`;
}

async function render(node: Node): Promise<HtmlString> {
  const t = node.app.t;
  const found = await repos(node.app);
  const cards = found.length ? found.map((repo) => repoCard(repo, t)) : [html.async`<div class=u2-card><div class=-body>${t`No git repository found.`}</div></div>`];
  return html.async`<div class="u2-flex git-repos">${cards}${serverCard(t)}</div>`;
}

// --- node API -------------------------------------------------------------

async function api(node: Node, vars: Record<string, unknown>): Promise<{ ok: boolean; message: string }> {
  try {
    return { ok: true, message: await act(node.app, String(vars.act ?? ""), String(vars.repo ?? ""), String(vars.message ?? "")) };
  } catch (e) {
    return { ok: false, message: errMsg(e) };
  }
}

export const cms = {
  node: { css: ["pub/main.css"], js: ["pub/main.js"], render, api },
};
