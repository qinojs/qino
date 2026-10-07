export { paymentProvider } from "./lib/provider.ts";

export const settingsSchema = {
  properties: {
    customerId: { type: "string" },
    terminalId: { type: "string" },
    user: { type: "string", description: "JSON API user (basic authentication)" },
    password: { type: "string" },
    live: { type: "boolean", description: "Use the production environment; the test environment otherwise" },
    methods: {
      type: "string",
      description: "Methods offered one by one, comma-separated Saferpay names (TWINT, VISA …); "
        + "empty: the payer chooses on Saferpay's page",
    },
  },
};
