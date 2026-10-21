import type { Row } from "@qino/qino";
import type { SourceType } from "@qino/qino/fin.hosting";

/** A website of the REST API, as far as read here: `ascii_name` is the punycode `name` without stray marks. */
type Site = { ascii_name?: string; aliases?: { ascii_name?: string }[] };

/** A Plesk server, as a host: signed in as user and password, or with an API key alone as the secret. */
export const domainSourceTypes: Record<string, SourceType> = { plesk: { kind: "host", domains: sites } };

/** Every website of a server — a webspace's, a subdomain, an addon domain — with its aliases. */
async function sites(source: Row): Promise<{ name: string; aliases: string[] }[]> {
  if (!source.url) throw new Error("no URL: https://s3.example.com:8443");
  const server = new URL(String(source.url));
  const [user, secret] = [String(source.user ?? ""), String(source.secret ?? "")];
  const res = await fetch(new URL("/api/v2/domains", server.origin), {
    headers: {
      accept: "application/json",
      ...user ? { authorization: `Basic ${btoa(`${user}:${secret}`)}` } : { "x-api-key": secret },
    },
    signal: AbortSignal.timeout(60_000),
  });
  const body = await res.json().catch(() => undefined);
  if (!res.ok || !Array.isArray(body)) {
    throw new Error(`Plesk ${server.hostname} answered ${res.status}: ${JSON.stringify(body ?? "").slice(0, 200)}`);
  }
  return (body as Site[]).filter((s) => s.ascii_name).map((s) => ({
    name: String(s.ascii_name),
    aliases: (s.aliases ?? []).map((a) => String(a.ascii_name ?? "")).filter(Boolean),
  }));
}
