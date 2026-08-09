export const KINDS = ["chat", "vision", "embedding", "image", "stt", "tts", "audio_generation", "video_generation"] as const;
export type Kind = typeof KINDS[number];

export type ClientContext = Record<string, unknown>;

export interface Tool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute(args: unknown, ctx: unknown): Promise<unknown>;
}

export interface Bot {
  id: string;
  provider?: string; // provider name override
  model?: string; // model_id override
  // static string or dynamic (server ctx + per-session client context)
  systemPrompt: string | ((ctx: unknown, clientContext: ClientContext) => string | Promise<string>);
  tools?: Tool[];
}

export type ProviderRow = {
  id: number;
  name: string;
  endpoint: string;
  timeout_ms: number;
};

export type ProviderModelRow = {
  id: number;
  provider_id: number;
  model_id: string;
  kind: Kind;
  is_default: number | boolean;
  used_input_tokens: number;
  used_output_tokens: number;
};
