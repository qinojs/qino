export type ClientContext = Record<string, unknown>;

export interface Tool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute(args: unknown, ctx: unknown): Promise<unknown>;
}

export interface Bot {
  id: string;
  provider?: string;
  model?: string;
  // static string or dynamic function (server ctx + client context)
  systemPrompt:
    | string
    | ((
      ctx: unknown,
      clientContext: ClientContext,
    ) => string | Promise<string>);
  tools?: Tool[];
  // structured chat output — must include a "response" string field
  chatSchema?: Record<string, unknown>;
}

export type ProviderStrength =
  | "speed"
  | "reasoning"
  | "multilingual"
  | "coding"
  | "vision"
  | "cost"
  | "quality"
  | "privacy"
  | "long-context"
  | "routing"
  | "model-choice"
  | "embedding"
  | (string & {});

export interface ProviderModelCapabilities {
  streaming?: boolean;
  tools?: boolean;
  toolChoiceAuto?: boolean;
  vision?: boolean;
  jsonMode?: boolean;
}

export interface ProviderCapabilities extends ProviderModelCapabilities {}

export interface ProviderModel {
  id: string;
  label?: string;
  description?: string;
  source?: string;
  syncedAt?: string;
  strengths?: ProviderStrength[];
  maxInputTokens?: number;
  maxOutputTokens?: number;
  costPerMToken?: number;
  inputCostPerMToken?: number;
  outputCostPerMToken?: number;
  supports?: ProviderModelCapabilities;
}

export interface ProviderConf {
  endpoint: string;
  jsonMode?: boolean;
  timeoutMs?: number;
  supports?: ProviderCapabilities;
  strengths?: ProviderStrength[];
  models?: ProviderModel[];
  defaultModel?: string;
  costPerMToken?: number;
  embeddingModel?: string;
}
