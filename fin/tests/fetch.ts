/** A request a test answered. */
export type Call = { url: URL; method: string; body: unknown };

/**
 * Answer the app's outgoing requests with `answer` while `fn` runs: an object is sent as JSON, a
 * Response as it is, nothing as 404. Every request is noted in the calls handed to `fn`.
 */
export async function withFetch(
  answer: (url: URL, call: Call) => unknown,
  fn: (calls: Call[]) => Promise<void>,
): Promise<void> {
  const calls: Call[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    const text = init?.body == null ? "" : String(init.body);
    // JSON as data, anything else (a form) as the text it is
    const body = text ? (() => {
      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
    })() : undefined;
    const call = { url, method: init?.method ?? "GET", body };
    calls.push(call);
    const out = await answer(url, call);
    if (out instanceof Response) return out;
    return out === undefined ? new Response("not found", { status: 404 }) : Response.json(out);
  };
  try {
    await fn(calls);
  } finally {
    globalThis.fetch = original;
  }
}
