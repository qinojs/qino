import { $item } from "../core/mod.ts";
import type { Node } from "../cms/mod.ts";

const FIELDS = new Set([
  "name", "alternateName", "description", "url",
  "organization.name", "organization.legalName", "organization.taxID", "organization.vatID",
  "organization.address.streetAddress", "organization.address.extendedAddress",
  "organization.address.postalCode", "organization.address.addressLocality",
  "organization.address.addressRegion", "organization.address.addressCountry",
  "contact.name", "contact.email", "contact.telephone",
  "brand.fontFamily", "brand.primaryColor", "brand.accentColor", "brand.backgroundColor",
]);
const ASSETS = new Set(["logo", "icon", "font"]);
const FONT_EXTENSIONS = new Set(["woff2", "woff", "ttf", "otf"]);

function assetName(value: unknown): string {
  const name = String(value ?? "");
  if (!ASSETS.has(name)) throw new Error("Unknown identity file");
  return name;
}

async function file(node: Node, name: string) {
  const id = Number(await node.app.db.one`SELECT file_id FROM identity_file WHERE name = ${name}`);
  return id ? await node.app.dbFiles.file(id) : undefined;
}

export default async function api(node: Node, vars: Record<string, unknown>): Promise<unknown> {
  if (vars.save && typeof vars.save === "object") {
    const set = node.app.settings[$item].sub(["identity"]);
    for (const [path, value] of Object.entries(vars.save as Record<string, unknown>)) {
      if (!FIELDS.has(path)) continue;
      const normalized = path === "organization.address.addressCountry"
        ? String(value ?? "").trim().toUpperCase()
        : String(value ?? "").trim();
      await set.sub(path.split(".")).set(normalized);
    }
    return { done: true };
  }
  if (vars.asset && typeof vars.asset === "object") {
    const asset = vars.asset as Record<string, unknown>;
    const name = assetName(asset.name);
    const source = String(asset.dataUrl ?? "");
    if (!source.startsWith("data:")) throw new Error("Missing identity file");
    const old = await file(node, name);
    const fresh = await node.app.dbFiles.add(source);
    try {
      const valid = name === "font" ? FONT_EXTENSIONS.has(fresh.extension) : fresh.mime.startsWith("image/");
      if (!valid) throw new Error(name === "font" ? "Choose a web font" : "Choose an image");
      await fresh.access(true);
      await node.app.db.table("identity_file").ensure({ name, file_id: fresh.id });
    } catch (e) {
      await fresh.remove();
      throw e;
    }
    if (old && old.id !== fresh.id && !await old.used()) await old.remove();
    return { done: true };
  }
  if (vars.removeAsset) {
    const name = assetName(vars.removeAsset);
    const old = await file(node, name);
    await node.app.db.table("identity_file").delete(name);
    if (old && !await old.used()) await old.remove();
    return { done: true };
  }
  return false;
}
