import type { App } from "@qino/qino";

const line = async (value: unknown) => String(await value ?? "").trim();

/** The portal's own contact data from the identity module, keyed as the legacy contact fields name it. */
export async function identityOwner(app: App): Promise<Record<string, string>> {
  const identity = app.settings.identity;
  const address = identity.organization.address;
  const [legalName, orgName, name, street, zip, city, phone, email, website] = await Promise.all([
    line(identity.organization.legalName),
    line(identity.organization.name),
    line(identity.contact.name),
    line(address.streetAddress),
    line(address.postalCode),
    line(address.addressLocality),
    line(identity.contact.telephone),
    line(identity.contact.email),
    line(identity.url),
  ]);
  return { company: legalName || orgName, name, address: street, zip, city, phone, email, website };
}
