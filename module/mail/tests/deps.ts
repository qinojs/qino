// Test-only surface of mail. Keeps the instance registry out of mod.ts, which stays minimal.
import { mailInstances } from "../lib/MailManager.ts";

/** Binds a stand-in mail manager to a (usually faked) app, so `mail(app)` resolves in tests. */
// deno-lint-ignore no-explicit-any
export const fakeMail = (app: object, fake: any): void => void mailInstances.set(app, fake);
