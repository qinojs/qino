import { hee } from "../core/lib/util.ts";
import { getCtx } from "../core/lib/RequestContext.ts";
import { backend } from "../cms.backend/mod.ts";
import { FileTransformer } from "../core/lib/transform/index.ts";
import type { Node } from "../cms/lib/Node.ts";
import type { App } from "../core/server.ts";

export const name = "cms.backend.superuser.dbfiles.transform";
export const needs = ["cms.backend"];

export async function install({ app }: { app: App }) {
  const P = await backend.install(app, name);
  if (P) {
    await P.title("en", "Transform");
    await P.title("de", "Transform");
  }
}

// --- Platform detection ---

type Platform = "debian" | "alpine" | "macos" | "windows" | "unknown";

async function detectPlatform(): Promise<Platform> {
  if (Deno.build.os === "darwin") return "macos";
  if (Deno.build.os === "windows") return "windows";
  if (Deno.build.os === "linux") {
    try {
      const text = await Deno.readTextFile("/etc/os-release");
      if (/ID(_LIKE)?=.*alpine/i.test(text)) return "alpine";
      if (/ID(_LIKE)?=.*(debian|ubuntu)/i.test(text)) return "debian";
    } catch { /* ignore */ }
  }
  return "unknown";
}

function isRoot(): boolean {
  return Deno.uid() === 0;
}

// --- Cache ---

function cacheDir(app: App): string {
  return app.appPATH + "cache/pri/";
}

async function cacheStats(dir: string): Promise<{ count: number; size: number }> {
  let count = 0, size = 0;
  try {
    for await (const entry of Deno.readDir(dir)) {
      if (!entry.name.startsWith("tf_")) continue;
      if (entry.name.endsWith(".mime")) continue;
      count++;
      size += (await Deno.stat(dir + entry.name).catch(() => null))?.size ?? 0;
    }
  } catch { /* dir may not exist */ }
  return { count, size };
}

async function clearCache(dir: string): Promise<number> {
  let deleted = 0;
  try {
    for await (const entry of Deno.readDir(dir)) {
      if (!entry.name.startsWith("tf_")) continue;
      await Deno.remove(dir + entry.name).catch(() => {});
      deleted++;
    }
  } catch { /* ignore */ }
  return deleted;
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(1)} GB`;
}

// --- Binaries ---

type Binary = {
  id: string;
  label: string;
  available: Promise<boolean>;
  install: Partial<Record<Platform, string>>;
  notes?: string;
};

const BINARIES: Binary[] = [
  {
    id: "imagemagick",
    label: "ImageMagick",
    available: FileTransformer.capabilities.magick,
    install: {
      debian: "apt install imagemagick",
      alpine: "apk add imagemagick",
      macos:  "brew install imagemagick",
    },
  },
  {
    id: "ffmpeg",
    label: "FFmpeg",
    available: FileTransformer.capabilities.ffmpeg,
    install: {
      debian: "apt install ffmpeg",
      alpine: "apk add ffmpeg",
      macos:  "brew install ffmpeg",
    },
  },
  {
    id: "pngquant",
    label: "pngquant",
    available: checkPngquant(),
    install: {
      debian: "apt install pngquant",
      alpine: "apk add pngquant",
      macos:  "brew install pngquant",
    },
  },
  {
    id: "libheif",
    label: "AVIF (libheif)",
    available: FileTransformer.capabilities.avif,
    install: {
      debian: "apt install libheif-dev",
      macos:  "brew install libheif",
    },
    notes: "Requires ImageMagick compiled with libheif.",
  },
];

async function checkPngquant(): Promise<boolean> {
  try {
    const { code } = await new Deno.Command("pngquant", {
      args: ["--version"],
      stdout: "piped",
      stderr: "piped",
    }).output();
    return code === 0;
  } catch {
    return false;
  }
}

async function runInstall(platform: Platform, bin: Binary): Promise<string> {
  const cmd = bin.install[platform];
  if (!cmd) return `No install command for platform "${platform}"`;
  const [prog, ...args] = cmd.split(" ");
  try {
    const { stdout, stderr, code } = await new Deno.Command(prog, {
      args,
      stdout: "piped",
      stderr: "piped",
    }).output();
    const dec = new TextDecoder();
    const out = dec.decode(stdout).trim();
    const err = dec.decode(stderr).trim();
    return code === 0
      ? (out || "Done.")
      : `Error (exit ${code}):\n${err || out}`;
  } catch (e) {
    return `Failed to run "${cmd}": ${e instanceof Error ? e.message : String(e)}`;
  }
}

async function resolveVersion(bin: Binary): Promise<string> {
  const cmds: Record<string, { cmd: string; args: string[] }> = {
    "imagemagick": { cmd: "magick",   args: ["-version"] },
    "ffmpeg":      { cmd: "ffmpeg",   args: ["-version"] },
    "pngquant":    { cmd: "pngquant", args: ["--version"] },
  };
  const entry = cmds[bin.id];
  if (!entry) return "";
  try {
    const { stdout } = await new Deno.Command(entry.cmd, {
      args: entry.args,
      stdout: "piped",
      stderr: "piped",
    }).output();
    return new TextDecoder().decode(stdout).split("\n")[0].trim();
  } catch {
    return "";
  }
}

const PLATFORM_LABELS: Record<Platform, string> = {
  debian:  "Debian/Ubuntu",
  alpine:  "Alpine",
  macos:   "macOS",
  windows: "Windows",
  unknown: "",
};

async function renderBinary(bin: Binary, platform: Platform, root: boolean): Promise<string> {
  const ok = await bin.available;
  const cls  = ok ? "-ok" : "-missing";
  const icon = ok ? `<u2-ico inline>check_circle</u2-ico>` : `<u2-ico inline>cancel</u2-ico>`;
  const notes = bin.notes ? `<br><small>${hee(bin.notes)}</small>` : "";
  const label = `${icon} ${hee(bin.label)}${notes}`;

  if (ok) {
    const version = await resolveVersion(bin);
    return `<tr class="${cls}"><td>${label}<td colspan=2><small>${hee(version)}</small>`;
  }

  const primaryCmd = bin.install[platform];
  const installEntries = primaryCmd
    ? [[platform, primaryCmd]] as [Platform, string][]
    : (Object.entries(bin.install) as [Platform, string][]);

  const installable = root && !!primaryCmd;

  return installEntries.map(([p, cmd], i) => {
    const displayCmd = root ? cmd : `sudo ${cmd}`;
    const installBtn = installable && i === 0
      ? ` <button data-install="${hee(bin.id)}" title="Install now"><u2-ico>download_for_offline</u2-ico></button>`
      : "";
    return `
    <tr class="${cls}${i > 0 ? " -extra" : ""}">
      ${i === 0 ? `<td rowspan="${installEntries.length}">${label}` : ""}
      <td style="white-space:nowrap">${hee(PLATFORM_LABELS[p] || p)}
      <td>
        <code>${hee(displayCmd)}</code>
        <button class=u2-unstyle data-copy="${hee(displayCmd)}" title="Copy"><u2-ico>content_copy</u2-ico></button>${installBtn}`;
  }).join("");
}

// --- Render ---

async function renderCache(app: App): Promise<string> {
  const dir = cacheDir(app);
  const stats = await cacheStats(dir);
  return `
<div class="u2-card">
  <div class="-head">${await app.t`Transform Cache`}</div>
  <table class="u2-table -Fields">
    <tr><th>${await app.t`Directory`}<td><code>${hee(dir)}</code>
    <tr><th>${await app.t`Files`}<td>${stats.count}
    <tr><th>${await app.t`Size`}<td>${hee(fmtBytes(stats.size))}
  </table>
  <div class="-body">
    <button data-clear-cache u2-confirm><u2-ico>delete_sweep</u2-ico> ${await app.t`Clear cache`}</button>
  </div>
</div>`;
}

async function render(node: Node, { vars = {} }: { vars?: Record<string, unknown> } = {}): Promise<string> {
  const ctx = getCtx();
  if (!await ctx.user?.get?.("superuser")) return "<div></div>";

  if (vars.install_binary) {
    if (!isRoot()) return JSON.stringify({ error: "Not running as root" });
    const bin = BINARIES.find(b => b.id === vars.install_binary);
    if (!bin) return JSON.stringify({ error: "Unknown binary" });
    const platform = await detectPlatform();
    const output = await runInstall(platform, bin);
    return JSON.stringify({ output });
  }

  if (vars.clear_cache) {
    await clearCache(cacheDir(node.app));
    return await renderCache(node.app);
  }

  const [[platform, root]] = await Promise.all([
    Promise.all([detectPlatform(), Promise.resolve(isRoot())]),
  ]);

  const rows = await Promise.all(BINARIES.map(bin => renderBinary(bin, platform, root)));

  const rootHint = !root
    ? `<p style="opacity:.7;font-style:italic">${hee("Running as non-root — use the copy button and run commands manually.")}</p>`
    : "";

  return `
<div class="-m-cms-backend-superuser-dbfiles-transform" data-sys-url="${hee(ctx.sysURL)}">
  <div class="u2-flex">

    <div cms-part="cache">${await renderCache(node.app)}</div>

    <div class="u2-card">
      <div class="-head">${await node.app.t`Transform Binaries`}</div>
      <div class="-body">${rootHint}</div>
      <table class="u2-table -transform-table">
        <thead><tr>
          <th>${await node.app.t`Binary`}
          <th>${await node.app.t`Platform`}
          <th>${await node.app.t`Install command`}
        </thead>
        <tbody>${rows.join("")}</tbody>
      </table>
    </div>

  </div>
</div>`;
}

async function renderCachePart(node: Node): Promise<string> {
  const ctx = getCtx();
  if (!await ctx.user?.get?.("superuser")) return "<div></div>";
  return renderCache(node.app);
}

export const cms = { node: { css: ["pub/main.css"], js: ["pub/main.js"], render, parts: { cache: renderCachePart } } };
