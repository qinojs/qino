import { errMsg } from "@qino/qino";

import type { ProviderRow } from "../types.ts";

// Thin transport for one OpenAI-compatible provider: auth, timeout, 429-retry.
// Higher layers (AiApi/ChatSession) own model resolution and usage accounting.
export class Provider {
  #row: ProviderRow;
  #key: string;

  constructor(row: ProviderRow, key: string) {
    this.#row = row;
    this.#key = key;
  }

  get name(): string { return this.#row.name; }
  #timeout(): number { return this.#row.timeout_ms || 60000; }

  /** POST to `path`, retrying transient 429s. Returns the raw `Response`. */
  async request(path: string, body: unknown): Promise<Response> {
    let res!: Response;
    for (let attempt = 0; attempt < 3; attempt++) {
      res = await fetch(this.#row.endpoint.replace(/\/+$/, "") + path, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer " + this.#key },
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
  json(path: string, body: unknown): Promise<Record<string, unknown>> {
    return this.#parsed(() => this.request(path, body));
  }

  form(path: string, body: FormData): Promise<Record<string, unknown>> {
    return this.#parsed(() => fetch(this.#row.endpoint.replace(/\/+$/, "") + path, {
      method: "POST",
      headers: { authorization: "Bearer " + this.#key },
      body,
      signal: AbortSignal.timeout(this.#timeout()),
    }));
  }

  async #parsed(send: () => Promise<Response>): Promise<Record<string, unknown>> {
    let res: Response;
    try {
      res = await send();
    } catch (error) {
      if (error instanceof DOMException && error.name === "TimeoutError") {
        return { error: `Provider "${this.#row.name}" timed out after ${Math.round(this.#timeout() / 1000)}s.` };
      }
      return { error: errMsg(error) };
    }
    const text = await res.text().catch(() => "");
    try { return JSON.parse(text); }
    catch { return { error: `Provider "${this.#row.name}": HTTP ${res.status} — ${text.slice(0, 300).trim() || "empty response"}` }; }
  }

  /** POST with `stream: true`; caller reads the SSE body. */
  stream(path: string, body: Record<string, unknown>): Promise<Response> {
    return this.request(path, { ...body, stream: true, stream_options: { include_usage: true } });
  }
}
