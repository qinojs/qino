// deno-lint-ignore-file no-explicit-any

// Public API of mail. The qino plugin lives in ./plugin.ts.

export interface MailManager {
  templates: Record<string, unknown>;
  create(values?: Record<string, unknown>): Promise<any>;
  build(values?: Record<string, unknown>): any;
  get(id: string | number): Promise<any>;
  defaults(): Promise<Record<string, string>>;
  secure(): Promise<string>;
}

declare module "../core/lib/App.ts" {
  interface App { mail: MailManager; }
}
