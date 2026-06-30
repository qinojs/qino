import type { ProviderRow } from "../types.ts";

// Thin transport for one OpenAI-compatible provider: auth, timeout, 429-retry.
// Higher layers (AiApi/ChatSession) own model resolution and usage accounting.
export class Provider {
  constructor(readonly row: ProviderRow, private key: string) {}

  get name(): string { return this.row.name; }
  #timeout(): number { return this.row.timeout_ms || 60000; }

  /** POST to `path`, retrying transient 429s. Returns the raw `Response`. */
  async request(path: string, body: unknown): Promise<Response> {
    let res!: Response;
    for (let attempt = 0; attempt < 3; attempt++) {
      res = await fetch(this.row.endpoint + path, {
        method: "POST",
        headers: { "content-type": "application/json", "authorization": "Bearer " + this.key },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.#timeout()),
      });
      if (res.status !== 429) return res;
      const retryAfter = parseFloat(res.headers.get("retry-after") ?? "1");
      if (res.headers.get("x-should-retry") === "false" || retryAfter > 30) return res;
      await new Promise((r) => setTimeout(r, Math.ceil(retryAfter * 1000) + 100));
    }
    return res;
  }

  /** POST and parse JSON; provider/transport errors come back as `{ error }`. */
  async json(path: string, body: unknown): Promise<Record<string, unknown>> {
    let res: Response;
    try {
      res = await this.request(path, body);
    } catch (error) {
      if (error instanceof DOMException && error.name === "TimeoutError") {
        return { error: `Provider "${this.row.name}" timed out after ${Math.round(this.#timeout() / 1000)}s.` };
      }
      return { error: error instanceof Error ? error.message : String(error) };
    }
    try { return await res.json(); }
    catch { return { error: "Invalid JSON response from provider" }; }
  }

  /** POST with `stream: true`; caller reads the SSE body. */
  stream(path: string, body: Record<string, unknown>): Promise<Response> {
    return this.request(path, { ...body, stream: true, stream_options: { include_usage: true } });
  }
}
