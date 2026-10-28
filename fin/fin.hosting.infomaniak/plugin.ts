import type { Row } from "@qino/qino";
import type { SourceType } from "@qino/qino/fin.hosting";

const API = "https://api.infomaniak.com/1/products";

/** A product of the API, as far as read here. */
type Product = { service_name?: string; customer_name?: string; account_id?: number; expired_at?: number | null };

/** Unix seconds as the day in Switzerland. */
const day = (seconds: number) => new Date(seconds * 1000).toLocaleDateString("sv-SE", { timeZone: "Europe/Zurich" });

/** An Infomaniak account, as a registrar: its API token the secret, the account (optional) as user. */
export const domainSourceTypes: Record<string, SourceType> = { infomaniak: { kind: "registrar", domains } };

async function domains(source: Row) {
  const token = String(source.secret ?? "");
  if (!token) throw new Error("no API token");
  const account = Number(source.user) || undefined;
  const products: Product[] = [];
  for (let page = 1, pages = 1; page <= pages; page++) {
    const res = await fetch(`${source.url || API}?per_page=500&page=${page}`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(30_000),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body.result !== "success") {
      throw new Error(`Infomaniak answered ${res.status}: ${JSON.stringify(body.error ?? body).slice(0, 200)}`);
    }
    products.push(...body.data ?? []);
    pages = Number(body.pages) || 1;
  }
  return products
    .filter((p) => p.service_name === "domain" && p.customer_name && (!account || p.account_id === account))
    .map((p) => ({ name: String(p.customer_name), expires: p.expired_at ? day(p.expired_at) : null }));
}
