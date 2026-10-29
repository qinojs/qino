import { html } from "@qino/qino";
import { cmsCtx } from "@qino/qino/cms";

import type { Ctx } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

const LANG_NAMES: Record<string, string> = {
  de: "Deutsch",
  fr: "Français",
  en: "English",
  it: "Italiano",
  es: "Español",
  nl: "Nederlands",
  pl: "Polski",
  cz: "Česky",
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

async function render(node: Node, { ctx }: { ctx: Ctx }) {
  const cms = node.cms;
  const settings = node.settings;

  const type       = settings.type() || "links";
  const hideActive = settings.hide_active();
  const longText   = settings.long_text();
  const toPageId   = settings.toPage();

  const langs = node.app.languages.all;
  if (langs.length < 2) return html`<span></span>`;

  const page = toPageId ? await cms.node(Number(toPageId)) : cmsCtx(ctx).mainNode;

  if (type === "select") {
    const options = langs.map((l) => {
      const label = longText ? (LANG_NAMES[l] ?? l) : l;
      const selected = l === ctx.lang ? " selected" : "";
      return html.async`<option${selected} value="${page.url(l)}" lang="${l}" class="-${l}">${label}`;
    });
    return html.async`<select aria-label="Languages">${options}</select>`;
  }

  // links (default)
  const shown = hideActive ? langs.filter((l) => l !== ctx.lang) : langs;
  const items = await Promise.all(shown.map(async (l) => {
    const active = l === ctx.lang;
    const name = LANG_NAMES[l] ?? l;
    const ariaLabel = longText ? "" : html` aria-label="${name}"`;
    const ariaCurrent = active ? html.raw(" aria-current=page") : "";
    return html`<li><a href="${await page.url(l)}" class="-${l}${active ? " -active" : ""}" lang="${l}" hreflang="${l}"${ariaLabel}${ariaCurrent}><span>${longText ? name : l}</span></a>`;
  }));

  return html`<nav aria-label=Languages><ul>${items}</ul></nav>`;
}

export const cms = {
  node: {
    css: ["pub/main.css"],
    js: ["pub/main.js"],
    render,
    settingsSchema,
  },
};
