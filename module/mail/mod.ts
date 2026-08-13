// Public API of mail. The qino plugin lives in ./plugin.ts.
import { mailInstances } from "./lib/MailManager.ts";

import type { App } from "@qino/qino";
import type { MailManager } from "./lib/MailManager.ts";

/** The app's mail manager. Throws when mail is not loaded. */
export function mail(app: App): MailManager {
  const manager = mailInstances.get(app);
  if (!manager) throw new Error('module "mail" is not loaded');
  return manager;
}

/** Undefined when mail is not loaded — for optional dependencies. */
mail.get = (app: App): MailManager | undefined => mailInstances.get(app);

export { addressOf } from "./lib/helpers.ts";
