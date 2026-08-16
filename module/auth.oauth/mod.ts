import type { App } from "@qino/qino";

/** Providers to offer users — only fully configured ones (client_id set). */
export const providers = (app: App): Promise<{ name: string }[]> =>
  app.db.query`SELECT name FROM social_login_provider WHERE client_id <> '' ORDER BY name`;
