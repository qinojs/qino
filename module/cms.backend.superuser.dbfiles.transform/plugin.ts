import { html, type HtmlString, FileTransformer, type App } from "../core/mod.ts";
import { backend } from "../cms.backend/mod.ts";
import type { Node } from "../cms/mod.ts";

export const name = "cms.backend.superuser.dbfiles.transform";
export const needs = ["cms.backend"];

export async function install({ app }: { app: App }) {
  await backend.install(app, name, { en: "Transform", de: "Transform" });
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

async function clearCache(dir: string, olderThanDays?: number): Promise<void> {
  const cutoff = olderThanDays ? Date.now() - olderThanDays * 86_400_000 : Infinity;
  try {
    for await (const entry of Deno.readDir(dir)) {
      if (!entry.name.startsWith("tf_")) continue;
      if (olderThanDays) {
        const mtime = (await Deno.stat(dir + entry.name).catch(() => null))?.mtime?.getTime() ?? 0;
        if (mtime > cutoff) continue;
      }
      await Deno.remove(dir + entry.name).catch(() => {});
    }
  } catch { /* ignore */ }
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
  noAutoInstall?: boolean;
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
    available: FileTransformer.capabilities.pngquant,
    install: {
      debian: "apt install pngquant",
      alpine: "apk add pngquant",
      macos:  "brew install pngquant",
    },
  },
  {
    id: "pandoc",
    label: "Pandoc",
    available: FileTransformer.capabilities.pandoc,
    install: {
      debian: "apt install pandoc",
      alpine: "apk add pandoc",
      macos:  "brew install pandoc",
    },
  },
  {
    id: "pdftotext",
    label: "pdftotext (Poppler)",
    available: FileTransformer.capabilities.pdftotext,
    install: {
      debian: "apt install poppler-utils",
      alpine: "apk add poppler-utils",
      macos:  "brew install poppler",
    },
  },
  {
    id: "tesseract",
    label: "Tesseract OCR",
    available: FileTransformer.capabilities.tesseract,
    install: {
      debian: "apt install tesseract-ocr tesseract-ocr-deu",
      alpine: "apk add tesseract-ocr tesseract-ocr-data-deu",
      macos:  "brew install tesseract tesseract-lang",
    },
  },
  {
    id: "libheif",
    label: "AVIF (libheif)",
    available: FileTransformer.capabilities.avif,
    install: {
      debian: "apt install imagemagick-6.q16 libheif-dev",
      macos:  "brew install imagemagick libheif",
    },
    noAutoInstall: true,
    notes: "Requires ImageMagick compiled with libheif support.",
  },
];


async function runInstall(platform: Platform, bin: Binary): Promise<string> {
  const cmd = bin.install[platform];
  if (!cmd) return `No install command for platform "${platform}"`;
  const [prog, ...args] = cmd.split(" ");
  if (prog === "apt") args.unshift("-y");
  try {
    const { stdout, stderr, code } = await new Deno.Command(prog, {
      args,
      stdout: "piped",
      stderr: "piped",
    }).output();
    const dec = new TextDecoder();
    const out = dec.decode(stdout).trim();
    const err = dec.decode(stderr).trim()
      .split("\n").filter(l => !l.startsWith("WARNING:")).join("\n").trim();
    const success = code === 0 || code === 100;
    if (!success) return `Error (exit ${code}):\n${err || out}`;
    FileTransformer.resetCapabilityCache();
    return (out || err).split("\n").findLast(Boolean) ?? "Done.";
  } catch (e) {
    return `Failed to run "${cmd}": ${e instanceof Error ? e.message : String(e)}`;
  }
}

async function resolveVersion(bin: Binary): Promise<string> {
  const cmds: Record<string, { cmd: string; args: string[]; extract?: (out: string) => string }[]> = {
    "imagemagick": [{ cmd: "magick", args: ["-version"] }, { cmd: "convert", args: ["-version"] }],
    "ffmpeg":      [{ cmd: "ffmpeg", args: ["-version"] }],
    "pngquant":    [{ cmd: "pngquant", args: ["--version"] }],
    "pandoc":      [{ cmd: "pandoc", args: ["--version"] }],
    "pdftotext":   [{ cmd: "pdftotext", args: ["-v"] }],
    "tesseract":   [{ cmd: "tesseract", args: ["--version"] }],
    "libheif":     [
      { cmd: "magick",   args: ["-list", "format"], extract: (o) => o.split("\n").find(l => /AVIF/i.test(l))?.trim() ?? "" },
      { cmd: "convert",  args: ["-list", "format"], extract: (o) => o.split("\n").find(l => /AVIF/i.test(l))?.trim() ?? "" },
    ],
  };
  const entries = cmds[bin.id];
  if (!entries) return "";
  for (const entry of entries) {
    try {
      const { code, stdout, stderr } = await new Deno.Command(entry.cmd, {
        args: entry.args,
        stdout: "piped",
        stderr: "piped",
      }).output();
      if (code !== 0) continue;
      const dec = new TextDecoder();
      const out = dec.decode(stdout).trim() || dec.decode(stderr).trim(); // pdftotext -v prints to stderr
      return entry.extract ? entry.extract(out) : out.split("\n")[0].trim();
    } catch { /* try next */ }
  }
  return "";
}

const PLATFORM_LABELS: Record<Platform, string> = {
  debian:  "Debian/Ubuntu",
  alpine:  "Alpine",
  macos:   "macOS",
  windows: "Windows",
  unknown: "",
};

async function renderBinary(bin: Binary, platform: Platform, root: boolean): Promise<HtmlString> {
  const ok = await bin.available;
  const cls  = ok ? "-ok" : "-missing";
  const icon = ok ? html`<u2-ico icon=check_circle inline>✓</u2-ico>` : html`<u2-ico icon=cancel inline>✗</u2-ico>`;
  const notes = bin.notes ? html`<br><small>${bin.notes}</small>` : "";
  const label = html`${icon} ${bin.label}${notes}`;

  if (ok) {
    return html`<tr class="${cls}"><td>${label}<td colspan=2><small>${await resolveVersion(bin)}</small>`;
  }

  const primaryCmd = bin.install[platform];
  const installEntries = primaryCmd
    ? [[platform, primaryCmd]] as [Platform, string][]
    : (Object.entries(bin.install) as [Platform, string][]);

  const installable = root && !!primaryCmd && !bin.noAutoInstall;

  return html.join(installEntries.map(([p, cmd], i) => {
    const displayCmd = root ? cmd : `sudo ${cmd}`;
    const installBtn = installable && i === 0
      ? html` <button data-install="${bin.id}" title="Install now" u2-confirm><u2-ico icon=download_for_offline>⤓</u2-ico></button>`
      : "";
    return html`
    <tr class="${cls}${i > 0 ? " -extra" : ""}">
      ${i === 0 ? html`<td rowspan="${installEntries.length}">${label}` : ""}
      <td style="white-space:nowrap">${PLATFORM_LABELS[p] || p}
      <td>
        <code>${displayCmd}</code>
        <button class=u2-unstyle data-copy="${displayCmd}" title="Copy"><u2-ico icon=content_copy>⧉</u2-ico></button>${installBtn}`;
  }));
}

// --- Render ---

async function renderCache(app: App): Promise<HtmlString> {
  const t = app.t;
  const dir = cacheDir(app);
  const stats = await cacheStats(dir);
  return html.async`
<div class="u2-card">
  <div class="-head">${t`Transform Cache`}</div>
  <table class="u2-table -Fields">
    <tr><th>${t`Directory`}<td><code>${dir}</code>
    <tr><th>${t`Files`}<td>${stats.count}
    <tr><th>${t`Size`}<td>${fmtBytes(stats.size)}
  </table>
  <div class="-body">
    <u2-menubutton>
      <button><u2-ico icon=delete_sweep>✕</u2-ico> ${t`Clear cache`} ▾</button>
      <menu>
        <li><button data-clear-cache="7" u2-confirm>${t`Older than 1 week`}</button>
        <li><button data-clear-cache="30" u2-confirm>${t`Older than 1 month`}</button>
        <li><button data-clear-cache="true" u2-confirm>${t`All`}</button>
      </menu>
    </u2-menubutton>
  </div>
</div>`;
}

async function render(node: Node, { vars = {} }: { vars?: Record<string, unknown> } = {}): Promise<HtmlString | string> {
  if (vars.install_binary) {
    if (!isRoot()) return JSON.stringify({ error: "Not running as root" });
    const bin = BINARIES.find(b => b.id === vars.install_binary);
    if (!bin) return JSON.stringify({ error: "Unknown binary" });
    const platform = await detectPlatform();
    const output = await runInstall(platform, bin);
    return JSON.stringify({ output });
  }

  if (vars.clear_cache) {
    const days = vars.clear_cache === true ? undefined : Number(vars.clear_cache) || undefined;
    await clearCache(cacheDir(node.app), days);
    return JSON.stringify({ ok: true });
  }

  const [platform, root] = await Promise.all([detectPlatform(), isRoot()]);

  const t = node.app.t;
  const rows = await Promise.all(BINARIES.map(bin => renderBinary(bin, platform, root)));

  const rootHint = !root
    ? html`<p style="opacity:.7;font-style:italic">Running as non-root — use the copy button and run commands manually.</p>`
    : "";

  return html.async`
<div>
  <div class="u2-flex">

    <div cms-part="cache">${renderCache(node.app)}</div>

    <div class="u2-card">
      <div class="-head">${t`Transform Binaries`}</div>
      <div class="-body">${rootHint}</div>
      <table class="u2-table -transform-table">
        <thead>
          <tr>
            <th>${t`Binary`}
            <th>${t`Platform`}
            <th>${t`Install command`}
        <tbody>${html.join(rows)}
      </table>
    </div>

  </div>
</div>`;
}

function renderCachePart(node: Node): Promise<HtmlString> {
  return renderCache(node.app);
}

export const cms = { node: { css: ["pub/main.css"], js: ["pub/main.js"], render, parts: { cache: renderCachePart } } };
