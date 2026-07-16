import { cmsCtx, type Node } from "../cms/mod.ts";
import { getCtx, hee } from "../core/mod.ts";

export const name = "cms.cont.lang.choose2";

const long: Record<string, string> = {
  de: "Deutsch",
  fr: "Français",
  en: "English",
  it: "Italiano",
  es: "Espanol",
  nl: "Nederlands",
  pl: "Polski",
  cz: "Cesky",
};

const settingsSchema = {
  properties: {
    type: {
      enum: ["links", "select"],
      description: "Display as linked list or as a select dropdown.",
    },
    hide_active: {
      type: "boolean",
      description: "Hide the currently active language.",
    },
    long_text: {
      type: "boolean",
      description: "Show full language name instead of language code.",
    },
    toPage: {
      type: "integer", minimum: 1,
      description: "Page whose URLs are used for the language links. Leave empty for the current page.",
      "x-html": { type: "qgcms-page" },
    },
  },
};

async function render(node: Node): Promise<string> {
  const ctx = getCtx();
  const cms = node.cms;
  const settings = node.settings;

  const type       = settings.type() || "links";
  const hideActive = settings.hide_active();
  const longText   = settings.long_text();
  const toPageId   = settings.toPage();

  const langs = node.app.languages.all;
  if (langs.length < 2) return "<span></span>";

  const Page = toPageId ? await cms.node(Number(toPageId)) : cmsCtx(ctx).mainNode;

  if (type === "select") {
    const options = await Promise.all(langs.map(async (l) => {
      const url = hee(await Page.url(l));
      const label = hee(longText ? (long[l] ?? l) : l);
      const selected = l === ctx.lang ? " selected" : "";
      return `<option${selected} value="${url}" lang="${hee(l)}" class="-${hee(l)}">${label}`;
    }));
    return `<select onchange="location.href=this.value+location.hash">${options.join("")}</select>`;
  }

  // links (default)
  const items = await Promise.all(langs.map(async (l) => {
    if (hideActive && l === ctx.lang) return "";
    const url = hee(await Page.url(l));
    const isActive = l === ctx.lang;
    const cls = [`-${l}`, isActive ? "-active" : ""].filter(Boolean).join(" ");
    const ariaLabel = !longText ? ` aria-label="${hee(long[l] ?? l)}"` : "";
    const ariaCurrent = isActive ? " aria-current=page" : "";
    const label = longText ? (long[l] ?? l) : l;
    return `<li><a href="${url}" onclick="event.preventDefault();location.href=this.href+location.hash" class="${cls}" lang="${hee(l)}" hreflang="${hee(l)}"${ariaLabel}${ariaCurrent}><span>${label}</span></a>`;
  }));

  const filteredItems = items.filter(Boolean).join("");
  if (!filteredItems) return "<span></span>";

  return `<nav aria-label="Languages"><ul>${filteredItems}</ul></nav>`;
}

export const cms = {
  node: {
    css: ["pub/main.css"],
    render,
    settingsSchema,
  },
};
