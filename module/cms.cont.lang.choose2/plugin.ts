import { cmsCtx, type Node } from "@qino/qino/cms";
import { html, type Ctx, type HtmlString } from "@qino/qino";

const LANG_NAMES: Record<string, string> = {
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

async function render(node: Node, { ctx }: { ctx: Ctx }): Promise<HtmlString> {
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
    const options = await Promise.all(langs.map(async (l) => {
      const label = longText ? (LANG_NAMES[l] ?? l) : l;
      const selected = l === ctx.lang ? " selected" : "";
      return html`<option${selected} value="${await page.url(l)}" lang="${l}" class="-${l}">${label}`;
    }));
    return html`<select onchange="location.href=this.value+location.hash">${options}</select>`;
  }

  // links (default)
  const items = await Promise.all(langs.map(async (l) => {
    if (hideActive && l === ctx.lang) return "";
    const isActive = l === ctx.lang;
    const cls = [`-${l}`, isActive ? "-active" : ""].filter(Boolean).join(" ");
    const ariaLabel = !longText ? html` aria-label="${LANG_NAMES[l] ?? l}"` : "";
    const ariaCurrent = isActive ? html.raw(" aria-current=page") : "";
    const label = longText ? (LANG_NAMES[l] ?? l) : l;
    return html`<li><a href="${await page.url(l)}" onclick="event.preventDefault();location.href=this.href+location.hash" class="${cls}" lang="${l}" hreflang="${l}"${ariaLabel}${ariaCurrent}><span>${label}</span></a>`;
  }));

  const filteredItems = items.filter(Boolean);
  if (!filteredItems.length) return html`<span></span>`;

  return html`<nav aria-label=Languages><ul>${filteredItems}</ul></nav>`;
}

export const cms = {
  node: {
    css: ["pub/main.css"],
    render,
    settingsSchema,
  },
};
