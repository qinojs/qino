// The journal reader lives here because only this panel needs its shape; tests read it the same way.
export { messages as journal, userMessages as userJournal } from "../lib/journal.ts";
