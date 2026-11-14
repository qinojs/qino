import { $item, AccessError, ApiError } from "@qino/qino";
import { add, list, remove, update } from "@qino/qino/cms.event";

import type { Range } from "@qino/qino/calendar";
import type { Node } from "@qino/qino/cms";

export default async function (node: Node, input: {
  blocks?: boolean; save?: Range & { id?: number; timeZone?: string }; remove?: number; details?: Record<string, unknown>;
}) {
  if (node.vs.module !== "cms.cont.event" || !await node.isReadable() || await node.access() < 2) throw new AccessError();
  const timeZone = String(node.settings.time_zone() ?? "UTC");
  if (input.details) {
    const values: Record<string, string | number | null> = {};
    const FIELDS = ["address_street", "address_postal_code", "address_locality", "address_country", "currency", "performer", "language", "external_link"];
    for (const key of FIELDS) if (key in input.details) {
      const value = input.details[key];
      if (typeof value !== "string") throw new ApiError(400, `Invalid event field: ${key}`);
      values[key] = value.trim();
    }
    if ("price" in input.details) {
      const price = input.details.price;
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
      let url: URL;
      try { url = new URL(String(values.external_link)); }
      catch { throw new ApiError(400, "Invalid external event URL"); }
      if (!["http:", "https:"].includes(url.protocol)) throw new ApiError(400, "External event URLs must use HTTP or HTTPS");
      values.external_link = url.href;
    }
    await node.settings[$item].patch(values);
    return { ok: true };
  }
  if (input.blocks) return (await list(node)).map((block) => {
    const allDay = !/[Tt ]/.test(block.start);
    const local = (value: string) => allDay ? value
      : Temporal.Instant.from(value).toZonedDateTimeISO(timeZone).toPlainDateTime().toString({ smallestUnit: "second" });
    return { ...block, allDay, localStart: local(block.start), localEnd: local(block.end), timeZone };
  });
  if (input.save) {
    const range = input.save;
    const zone = range.timeZone || timeZone;
    const instant = (value: string) => !/[Tt ]/.test(value) || /(?:Z|[+-]\d\d:\d\d|\])$/i.test(value) ? value
      : Temporal.PlainDateTime.from(value).toZonedDateTime(zone, { disambiguation: "reject" }).toInstant().toString();
    const values = { start: instant(range.start), end: instant(range.end) };
    if (!range.id) return { id: Number(await add(node, values)) };
    if (!await update(node, Number(range.id), values)) throw new ApiError(404, "Event block not found");
    return { id: Number(range.id) };
  }
  if (input.remove) {
    await remove(node, Number(input.remove));
    return { ok: true };
  }
  return null;
}
