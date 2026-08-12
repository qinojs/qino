import dbSchema from "./dbschema.json" with { type: "json" };

export { dbSchema };

const text = (description: string, format?: string) => ({
  type: "string",
  ...(format && { format }),
  description,
});

export const settingsSchema = {
  properties: {
    name: text("Public name of the portal."),
    alternateName: text("Short or alternate portal name."),
    description: { ...text("Short public description of the portal."), "x-multiline": true },
    url: text("Canonical public URL of the portal.", "uri"),
    organization: {
      description: "Organization responsible for the portal.",
      properties: {
        name: text("Public organization name."),
        legalName: text("Full registered organization name."),
        taxID: text("Tax identification number."),
        vatID: text("VAT identification number."),
        address: {
          description: "Postal address of the organization.",
          properties: {
            streetAddress: text("Street and house number."),
            extendedAddress: text("Additional address information, such as c/o or a department."),
            postalCode: text("Postal code."),
            addressLocality: text("City or locality."),
            addressRegion: text("State, canton, province, or region."),
            addressCountry: { ...text("ISO 3166-1 alpha-2 country code."), minLength: 2, maxLength: 2 },
          },
        },
      },
    },
    contact: {
      description: "Primary public contact point.",
      properties: {
        name: text("Name of the contact person or team."),
        email: text("Public contact email address.", "email"),
        telephone: { ...text("Public telephone number."), "x-html": { type: "tel" } },
      },
    },
    brand: {
      description: "Public brand assets and base colors.",
      properties: {
        fontFamily: text("Name of the uploaded font family."),
        primaryColor: text("Primary brand color.", "color"),
        accentColor: text("Accent color for highlights.", "color"),
        backgroundColor: text("Default brand background color.", "color"),
      },
    },
  },
};
