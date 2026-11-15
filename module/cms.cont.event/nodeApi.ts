import { $item, AccessError, ApiError } from "@qino/qino";
import { exact, isDate, toLocal } from "@qino/qino/calendar";
import { add, list, remove, update } from "@qino/qino/cms.event";

import type { Range } from "@qino/qino/calendar";
import type { Node } from "@qino/qino/cms";

const TEXTS = ["address_street", "address_postal_code", "address_locality", "address_country", "currency", "performer", "language", "external_link"];

/** Normalize and store the supplied detail settings; fields left out keep their value. */
async function saveDetails(node: Node, input: Record<string, unknown>) {
  const values: Record<string, string | number | null> = {};
  for (const key of TEXTS) if (key in input) {
    const value = input[key];
    if (typeof value !== "string") throw new ApiError(400, `Invalid event field: ${key}`);
    values[key] = value.trim();
  }
  if ("price" in input) {
    const price = input.price;
    if (price !== null && (typeof price !== "number" || !Number.isFinite(price) || price < 0)) throw new ApiError(400, "Invalid event price");
    values.price = price;
  }
  if (typeof values.currency === "string") values.currency = values.currency.toUpperCase();
  if (typeof values.address_country === "string") values.address_country = values.address_country.toUpperCase();
  const currency = values.currency ?? node.settings.currency();
  const price = "price" in values ? values.price : node.settings.price();
  if (currency && !/^[A-Z]{3}$/.test(String(currency)) || price != null && price !== "" && !currency)
    throw new ApiError(400, "A price requires an ISO 4217 currency");
  if (values.address_country && !/^[A-Z]{2}$/.test(String(values.address_country))) throw new ApiError(400, "Invalid venue country code");
  if (values.language) {
    try { values.language = new Intl.Locale(String(values.language)).toString(); }
    catch { throw new ApiError(400, "Invalid event language"); }
  }
  if (values.external_link) {
    const url = URL.parse(String(values.external_link));
    if (!url || !["http:", "https:"].includes(url.protocol)) throw new ApiError(400, "External event URLs must use HTTP or HTTPS");
    values.external_link = url.href;
  }
  await node.settings[$item].patch(values);
  return { ok: true };
}

export default async function (node: Node, input: {
  blocks?: boolean; save?: Range & { id?: number; timeZone?: string }; remove?: number; details?: Record<string, unknown>;
}) {
  if (await node.access() < 2) throw new AccessError();
  if (input.details) return saveDetails(node, input.details);
  const timeZone = String(node.settings.time_zone() ?? "UTC");
  if (input.blocks) return (await list(node)).map((block) => {
    const allDay = isDate(block.start);
    const local = (value: string) => allDay ? value : toLocal(value, timeZone);
    return { ...block, allDay, localStart: local(block.start), localEnd: local(block.end), timeZone };
  });
  if (input.save) {
    const { id } = input.save, zone = input.save.timeZone || timeZone;
    new Intl.DateTimeFormat(undefined, { timeZone: zone }); // rejects an unknown time zone
    const range = { start: exact(input.save.start, zone), end: exact(input.save.end, zone) };
    if (id && !await update(node, Number(id), range)) throw new ApiError(404, "Event block not found");
    const saved = id ? Number(id) : Number(await add(node, range));
    if (!node.settings.time_zone() && input.save.timeZone) await node.settings[$item].patch({ time_zone: zone });
    return { id: saved, ...range };
  }
  if (input.remove) {
    await remove(node, Number(input.remove));
    return { ok: true };
  }
  return null;
}
