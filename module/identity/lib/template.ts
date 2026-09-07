import { hee, html } from "@qino/qino";

import { file } from "../mod.ts";

import type { App, TemplatePlaceholder } from "@qino/qino";

/** Public identity settings a CMS template may explicitly name. */
const PATHS = [
  "name", "alternateName", "description", "url",
  "organization.name", "organization.legalName", "organization.taxID", "organization.vatID",
  "organization.address.streetAddress", "organization.address.extendedAddress",
  "organization.address.postalCode", "organization.address.addressLocality",
  "organization.address.addressRegion", "organization.address.addressCountry",
  "contact.name", "contact.email", "contact.telephone",
  "brand.fontFamily", "brand.primaryColor", "brand.accentColor", "brand.backgroundColor",
];

const settings: Record<string, TemplatePlaceholder> = Object.fromEntries(PATHS.map((path) => [path, async (app: App) => {
  const value = await line(path.split(".").reduce((item, key) => item[key], app.settings.identity));
  return value ? { text: value } : undefined;
}]));

/** Public identity settings and derived display values, shared by every template renderer. */
export const templatePlaceholders: Record<string, TemplatePlaceholder> = {
  ...settings,
  "organization.address.formatted": async (app) => {
    const org = app.settings.identity.organization;
    const town = [await line(org.address.postalCode), await line(org.address.addressLocality)].filter(Boolean).join(" ");
    const parts = [await line(org.name), await line(org.address.streetAddress), town].filter(Boolean);
    return parts.length ? { text: parts.join(", "), html: html.raw(parts.map(hee).join("<br>")) } : undefined;
  },
  ...asset("logo", 40),
  ...asset("icon", 64, true),
};

/** An uploaded asset at its display height — delivered at twice that, for retina. */
function asset(name: string, height: number, square = false): Record<string, TemplatePlaceholder> {
  const transform = square ? { w: height * 2, h: height * 2 } : { h: height * 2 };
  const url = async (app: App) => {
    const asset = await file(app, name).catch(() => undefined);
    const [path, base] = await Promise.all([asset?.url(transform).catch(() => undefined), app.url().catch(() => undefined)]);
    return path && base ? new URL(path, base).href : undefined;
  };
  return {
    [`brand.${name}`]: async (app) => {
      const src = await url(app);
      if (!src) return;
      const alt = await line(app.settings.identity.name);
      return { text: alt, html: html.raw(`<img src="${hee(src)}" alt="${hee(alt)}" height="${height}">`) };
    },
    [`brand.${name}Url`]: async (app) => {
      const value = await url(app);
      return value ? { text: value } : undefined;
    },
  };
}

const line = async (value: unknown) => String(await value ?? "").trim();
