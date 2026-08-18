// Minimal SSE helpers. `sse()` encodes one event for our client protocol;
// `readSse()` parses an upstream OpenAI-style `data: …` stream.

const encoder = new TextEncoder();

export function sse(obj: unknown): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(obj)}\n\n`);
}

export async function readSse(res: Response, onData: (data: Record<string, unknown>) => void): Promise<void> {
  const reader = res.body?.getReader();
  if (!reader) return;
  const decoder = new TextDecoder();
  let buf = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      buf += decoder.decode(value, { stream: !done }).replaceAll("\r", ""); // CR is only ever a line terminator here
      if (done) buf += "\n\n"; // flush a trailing event that lacks the final blank line
      let nl: number;
      while ((nl = buf.indexOf("\n\n")) >= 0) {
        const event = buf.slice(0, nl);
        buf = buf.slice(nl + 2);
        for (const line of event.split("\n")) {
          const m = line.match(/^data:\s?(.*)$/);
          if (!m) continue;
          if (m[1] === "[DONE]") return;
          let data; try { data = JSON.parse(m[1]); } catch { continue; } // keepalive / non-json
          onData(data);
        }
      }
      if (done) return;
    }
  } finally {
    await reader.cancel().catch(() => {}); // `[DONE]` returns mid-stream — the upstream body stays open otherwise
  }
}
