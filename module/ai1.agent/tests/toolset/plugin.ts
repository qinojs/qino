import type { App, Tool } from "@qino/qino";

// A module with an ability declares it as a tool set, by name.
export const ai1Tools = {
  clock: (_app: App): Tool[] => [{ name: "now", description: "The time", parameters: { type: "object" }, execute: () => Promise.resolve("noon") }],
};
