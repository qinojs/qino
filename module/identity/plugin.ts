export { default as dbSchema } from "./dbschema.json" with { type: "json" };
export { messagingPlaceholders } from "./lib/messaging.ts";

const text = (description: string, maxLength = 191, format?: string) => ({
  type: "string",
  maxLength,
  "x-multiline": false,
  ...(format && { format }),
  description,
});

export const settingsSchema = {
  properties: {
    name: text("Public name of the portal."),
    alternateName: text("Short or alternate portal name.", 64),
    description: { ...text("Short public description of the portal.", 1000), "x-multiline": true },
    url: text("Canonical public URL of the portal.", 2048, "uri"),
    organization: {
      description: "Organization responsible for the portal.",
      properties: {
        name: text("Public organization name."),
        legalName: text("Full registered organization name."),
        taxID: text("Tax identification number.", 64),
        vatID: text("VAT identification number.", 64),
        address: {
          description: "Postal address of the organization.",
          properties: {
            streetAddress: text("Street and house number."),
            extendedAddress: text("Additional address information, such as c/o or a department."),
            postalCode: text("Postal code.", 32),
            addressLocality: text("City or locality."),
            addressRegion: text("State, canton, province, or region."),
            addressCountry: { ...text("ISO 3166-1 alpha-2 country code.", 2), minLength: 2 },
          },
        },
      },
    },
    contact: {
      description: "Primary public contact point.",
      properties: {
        name: text("Name of the contact person or team."),
        email: text("Public contact email address.", 254, "email"),
        telephone: { ...text("Public telephone number.", 32), "x-html": { type: "tel" } },
      },
    },
    brand: {
      description: "Public brand assets and base colors.",
      properties: {
        fontFamily: text("Name of the uploaded font family."),
        primaryColor: text("Primary brand color.", 64, "color"),
        accentColor: text("Accent color for highlights.", 64, "color"),
        backgroundColor: text("Default brand background color.", 64, "color"),
      },
    },
  },
};
