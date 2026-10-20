import type { App } from "@qino/qino";
import type { Source } from "@qino/qino/fin.hosting";

export const settingsSchema = {
  properties: {
    servers: {
      type: "string",
      description: "The Plesk servers, one URL per line, signing in as user and password, or with an API key alone: "
        + "https://admin:password@s3.example.com:8443, https://<api key>@s4.example.com:8443",
    },
  },
};

/** A website of the REST API, as far as read here: `ascii_name` is the punycode `name` without stray marks. */
type Site = { ascii_name?: string; aliases?: { ascii_name?: string }[] };

/** The servers of the setting, each as its URL. */
const servers = async (app: App) =>
  String(await app.settings["fin.hosting.plesk"].servers ?? "").split(/\s+/).filter(Boolean).map((line) => new URL(line));

/** Each server, as one host: plesk:s3.example.com. */
export const domainHosts = async (app: App): Promise<Source[]> =>
  (await servers(app)).map((url) => ({ name: `plesk:${url.hostname}`, domains: () => sites(url) }));

/** Every website of a server — a webspace's, a subdomain, an addon domain — with its aliases. */
async function sites(server: URL): Promise<{ name: string; aliases: string[] }[]> {
  const [user, password] = [decodeURIComponent(server.username), decodeURIComponent(server.password)];
  const res = await fetch(new URL("/api/v2/domains", server.origin), {
    headers: {
      accept: "application/json",
      ...password ? { authorization: `Basic ${btoa(`${user}:${password}`)}` } : { "x-api-key": user },
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
