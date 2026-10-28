// deno-lint-ignore-file no-explicit-any
import { AiError } from "./request.ts";

import type { MusicInput } from "../mod.ts";
import type { Adapter, Call } from "./request.ts";

// fal.ai: many models behind one queue (endpoint https://queue.fal.run), each with its own input
// fields. Its public OpenAPI tells them, so ai's input goes into the fields the model has.

const MODELS = "https://api.fal.ai/v1/models";

/** ai's input → the model's field, first one it has; `scale` turns seconds into its unit. */
const FIELDS: Record<string, { name: string; scale?: number }[]> = {
  prompt: [{ name: "prompt" }, { name: "tags" }, { name: "style_prompt" }],
  lyrics: [{ name: "lyrics" }, { name: "lyrics_prompt" }],
  seconds: [{ name: "duration" }, { name: "seconds_total" }, { name: "duration_seconds" }, { name: "music_length_ms", scale: 1000 }],
};

// a model's input schema, by app (with its endpoint id)
const schemas = new WeakMap<object, Map<string, Promise<any>>>();

function schema(call: Call): Promise<{ properties?: Record<string, any>; required?: string[] }> {
  const cache = schemas.get(call.app) ?? schemas.set(call.app, new Map()).get(call.app)!;
  if (!cache.has(call.model)) {
    cache.set(call.model, fetch(`${MODELS}?endpoint_id=${encodeURIComponent(call.model)}&expand=openapi-3.0`, { signal: AbortSignal.timeout(30_000) }).then(async (res) => {
      const api = (await res.json()).models?.[0]?.openapi;
      const post = Object.values(api?.paths ?? {}).map((p: any) => p.post).find((p: any) => p?.requestBody);
      const ref = post?.requestBody.content["application/json"].schema.$ref;
      if (!ref) throw new AiError(`fal: no input schema for "${call.model}"`, 502);
      return api.components.schemas[ref.split("/").pop()];
    }).catch((e) => (cache.delete(call.model), Promise.reject(e))));
  }
  return cache.get(call.model)!;
}

/** ai's input in the model's fields; a required field left empty fails before anything is paid. */
async function body(call: Call, input: Record<string, unknown>) {
  const { properties = {}, required = [] } = await schema(call);
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value == null) continue;
    const field = FIELDS[key]?.find((f) => f.name in properties);
    if (!field) continue;
    const scaled = typeof value === "number" ? value * (field.scale ?? 1) : value;
    out[field.name] = properties[field.name].type === "integer" ? Math.round(scaled as number) : scaled;
  }
  const missing = required.filter((name) => !(name in out));
  if (missing.length) throw new AiError(`fal: "${call.model}" needs ${missing.join(", ")}`, 400);
  return out;
}

const auth = (call: Call) => ({ authorization: "Key " + call.key });
// the queue's own URLs, below the endpoint
const path = (call: Call, url: string) => url.slice(call.endpoint.replace(/\/+$/, "").length);

/** Queue the request, wait until it is done and take its result. */
async function run(call: Call, input: Record<string, unknown>) {
  const res = await call.fetch("/" + call.model, {
    method: "POST",
    headers: { ...auth(call), "content-type": "application/json" },
    body: JSON.stringify(await body(call, input)),
  });
  const { status_url, response_url } = await res.json();
  for (;;) {
    const status = await (await call.fetch(path(call, status_url), { headers: auth(call) })).json();
    if (status.error) throw new AiError(`fal: ${status.error}`);
    if (status.status === "COMPLETED") break;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return (await call.fetch(path(call, response_url), { headers: auth(call) })).json();
}

/** The first file of a result (`audio`, `audio_file` …): its URL. */
const file = (result: any): string => {
  const url = Object.values(result ?? {}).find((v: any) => typeof v?.url === "string") as { url: string } | undefined;
  if (!url) throw new AiError("fal: no file in the answer", 502);
  return url.url;
};

export const fal: Adapter = {
  music: async (call, input: MusicInput) => {
    const url = file(await run(call, input));
    call.usage(input.prompt.length, 1);
    return url;
  },
};
