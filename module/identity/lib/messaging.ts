import { hee } from "@qino/qino";

import { file } from "../mod.ts";

import type { App } from "@qino/qino";
import type { Placeholder } from "@qino/qino/messaging";

// What a message may name from the portal's own identity — its brand, its address, its assets.
// The same in every message, so `to` is never looked at; the renderer works out only the ones a
// template actually names.

/** The display height a logo is delivered at, twice over for retina — as the layouts do it. */
const LOGO_HEIGHT = 40;
const ICON_SIZE = 64;

export const messagingPlaceholders: Record<string, Placeholder> = {
  ...settings({
    brand: "name",
    brandShort: "alternateName",
    brandDescription: "description",
    brandUrl: "url",
    orgName: "organization.name",
    orgLegalName: "organization.legalName",
    orgStreet: "organization.address.streetAddress",
    orgPostalCode: "organization.address.postalCode",
    orgLocality: "organization.address.addressLocality",
    orgCountry: "organization.address.addressCountry",
    contactName: "contact.name",
    contactEmail: "contact.email",
    contactPhone: "contact.telephone",
    fontFamily: "brand.fontFamily",
    primaryColor: "brand.primaryColor",
    accentColor: "brand.accentColor",
    backgroundColor: "brand.backgroundColor",
  }),
  ...asset("logo", { h: LOGO_HEIGHT * 2 }, LOGO_HEIGHT),
  ...asset("icon", { w: ICON_SIZE * 2, h: ICON_SIZE * 2 }, ICON_SIZE),
  orgAddress: async (app) => {
    const address = app.settings.identity.organization.address;
    const street = await line(address.streetAddress);
    const town = [await line(address.postalCode), await line(address.addressLocality)].filter(Boolean).join(" ");
    const parts = [await line(app.settings.identity.organization.name), street, town].filter(Boolean);
    if (!parts.length) return;
    return { text: parts.join(", "), html: parts.map(hee).join("<br>") };
  },
};

/** A settings leaf, as it stands in text and escaped in markup. Leaves are read one by one. */
function settings(names: Record<string, string>): Record<string, Placeholder> {
  return Object.fromEntries(
    Object.entries(names).map(([name, path]) => [name, async (app: App) => {
      const value = await line(path.split(".").reduce((item, key) => item[key], app.settings.identity));
      return value ? { text: value, html: hee(value) } : undefined;
    }]),
  );
}

/**
 * An uploaded asset: `{{identity.logo}}` is the image ready to place, `{{identity.logoUrl}}` its address alone —
 * for a template that wants its own size or a background. In text there is no image to show, so
 * the name stands there — an address nobody can follow is not what a letterhead says.
 *
 * A message sent outside a request has no url to build from, and then there is simply no image:
 * a mail whose logo is missing still goes out.
 */
function asset(name: string, transform: Record<string, number>, height: number): Record<string, Placeholder> {
  const address = async (app: App) => {
    const asset = await file(app, name).catch(() => undefined);
    const [path, base] = await Promise.all([
      asset?.url(transform).catch(() => undefined),
      app.url().catch(() => undefined),
    ]);
    return path && base ? new URL(path, base).href : undefined;
  };
  return {
    [name]: async (app: App) => {
      const url = await address(app);
      if (!url) return;
      const alt = await line(app.settings.identity.name);
      return { text: alt, html: `<img src="${hee(url)}" alt="${hee(alt)}" height="${height}">` };
    },
    [name + "Url"]: async (app: App) => {
      const url = await address(app);
      return url ? { text: url, html: hee(url) } : undefined;
    },
  };
}

const line = async (value: unknown) => String(await value ?? "").trim();
