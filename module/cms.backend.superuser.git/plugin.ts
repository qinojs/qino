import { fromFileUrl } from "@std/path";
import { errMsg, getCtx, html, type App, type HtmlString } from "../core/mod.ts";
import { backend } from "../cms.backend/mod.ts";
import type { Node } from "../cms/mod.ts";
import { git, reposOf, status, type Repo } from "./lib/git.ts";
import manifest from "./manifest.json" with { type: "json" };
const { name } = manifest;

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, name, { en: "Git", de: "Git" });
}

/** Every directory the app is made of, and what it holds — modules, stores and the app itself.
 *  Which of them share a repository is git's answer, not ours. */
type Holds = { kind: "app" | "module" | "store"; label: string };

function candidates(app: App): Map<string, Holds> {
  const dirs = new Map<string, Holds>([[app.appPATH, { kind: "app", label: app.appPATH }]]);
  for (const mod of Object.values(app.modules.all())) if (mod.dir) dirs.set(mod.dir, { kind: "module", label: mod.name });
  for (const store of app.stores.all()) {
    if (!store.base.startsWith("file:")) continue;
    const dir = fromFileUrl(store.base);
    dirs.set(dir, { kind: "store", label: dir.split("/").filter(Boolean).at(-1) ?? dir });
  }
  return dirs;
}

async function repos(app: App): Promise<Repo<Holds>[]> {
  const found = await reposOf(candidates(app));
  return Promise.all([...found].map(async ([root, holds]) => ({ root, holds, ...await status(root) })));
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
  const parts = [await user?.get("firstname"), await user?.get("lastname")].filter(Boolean).join(" ");
  const email = String(await user?.get("email") ?? "");
  if (!parts && !email) return [];
  return ["-c", `user.name=${parts || email}`, "-c", `user.email=${email}`];
}

async function act(app: App, action: string, root: string, message: string): Promise<string> {
  // Never a path from the client: only a repository this app actually sits in may be touched.
  const known = await repos(app);
  const repo = known.find((r) => r.root === root);
  if (!repo) throw new Error(`Not a repository of this app: ${root}`);

  if (action === "push") return run(await git(repo.root, ["push"], 120_000));
  if (action === "pull") return run(await git(repo.root, ["pull", "--ff-only"], 120_000));
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
    <button data-act=push${repo.ahead ? "" : html` disabled`}>${t`Push`}</button>
    <button data-act=pull${repo.behind ? "" : html` disabled`}>${t`Pull`}</button>
  </div>
</div>`;
}

async function render(node: Node): Promise<HtmlString> {
  const t = node.app.t;
  const found = await repos(node.app);
  if (!found.length) return html.async`<div class=u2-card><div class=-body>${t`No git repository found.`}</div></div>`;
  return html.async`<div class="u2-flex git-repos">${found.map((repo) => repoCard(repo, t))}</div>`;
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
